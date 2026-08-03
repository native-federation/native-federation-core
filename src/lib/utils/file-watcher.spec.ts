import { describe, expect, it, vi } from 'vitest';
import * as path from 'path';
import { createNfWatcherCore, syncNfFileWatcher } from './file-watcher.js';
import { createMemoryIo } from './io/__test-helpers__/memory-io.js';
import { logger } from './logger.js';

// A fixed clock keeps the replay grace window (2000ms after a path's mtime)
// deterministic; memory-io reports mtime 0 unless setMtime says otherwise, which
// would make every seeded file look ancient against a real Date.now().
const NOW = 1_700_000_000_000;
const clock = () => NOW;
const AGED = NOW - 60_000; // well outside the grace window
const posix = (p: string): string => path.resolve(p).replace(/\\/g, '/');

// Tracked files are watched through their containing directory, so an event for one
// arrives on that directory carrying the entry name.
const emitFile = (io: ReturnType<typeof createMemoryIo>, file: string): void =>
  io.emit(path.dirname(file), path.basename(file));

describe('createNfWatcherCore', () => {
  it('accumulates changed paths in dirtyPaths when no onChange handler is given', () => {
    const dir = path.resolve('/proj/src');
    const io = createMemoryIo().setDir(dir);
    const watcher = createNfWatcherCore(io, {});

    watcher.addPaths(dir);
    io.emit(dir, 'a.ts');

    expect([...watcher.get()]).toEqual([`${dir.replace(/\\/g, '/')}/a.ts`]);
  });

  // Both channels must fire: the angular-adapter build builder wakes its rebuild
  // loop from onChange but reads *which* files changed from get()/clear().
  it('buffers into dirtyPaths and invokes onChange when a handler is provided', () => {
    const file = path.resolve('/proj/file.ts');
    const io = createMemoryIo().setFile(file, '').setMtime(file, AGED);
    const onChange = vi.fn();
    const watcher = createNfWatcherCore(io, { onChange }, clock);

    watcher.addPaths(file);
    io.setMtime(file, NOW); // the save the event reports
    emitFile(io, file);

    expect(onChange).toHaveBeenCalledWith(posix(file));
    expect([...watcher.get()]).toEqual([posix(file)]);
  });

  it('has already recorded the path by the time onChange runs', () => {
    const file = path.resolve('/proj/file.ts');
    const io = createMemoryIo().setFile(file, '').setMtime(file, AGED);
    const seen: string[][] = [];
    const watcher = createNfWatcherCore(
      io,
      { onChange: () => seen.push([...watcher.get()]) },
      clock
    );

    watcher.addPaths(file);
    io.setMtime(file, NOW);
    emitFile(io, file);

    expect(seen).toEqual([[posix(file)]]);
  });

  it('does not register the same path twice', () => {
    const dir = path.resolve('/proj/src');
    const io = createMemoryIo().setDir(dir);
    const spy = vi.spyOn(io, 'watch');
    const watcher = createNfWatcherCore(io, {});

    watcher.addPaths([dir, dir]);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  // A directory watch that never opened takes every source under it down with it,
  // so the first failure is a warning rather than a debug line. Subsequent ones
  // drop back to debug: descriptor exhaustion fails every directory after the first.
  it('warns once (and swallows) when a path cannot be watched', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const debug = vi.spyOn(logger, 'debug').mockImplementation(() => undefined);
    const io = createMemoryIo();
    io.watch = () => {
      throw new Error('boom');
    };

    const watcher = createNfWatcherCore(io, {});
    expect(() => watcher.addPaths(['/a/one.ts', '/b/two.ts', '/c/three.ts'])).not.toThrow();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('/a');
    expect(debug).toHaveBeenCalledTimes(2);
  });

  it('passes the poll option to io.watch for polled paths', () => {
    const dir = path.resolve('/proj/src');
    const io = createMemoryIo().setDir(dir);
    const spy = vi.spyOn(io, 'watch');
    const watcher = createNfWatcherCore(io, { pollIntervalMs: 250 });

    watcher.addPaths(dir, { poll: true });

    expect(spy).toHaveBeenCalledWith(
      dir,
      expect.objectContaining({ recursive: true, poll: { intervalMs: 250 } }),
      expect.any(Function)
    );
  });

  it('coalesces a burst of events into one delivery per path when debounced', () => {
    vi.useFakeTimers();
    const dir = path.resolve('/proj/src').replace(/\\/g, '/');
    const io = createMemoryIo().setDir(dir);
    const onChange = vi.fn();
    const watcher = createNfWatcherCore(io, { onChange, debounceMs: 50 });

    watcher.addPaths(dir);
    io.emit(dir, 'a.ts');
    io.emit(dir, 'a.ts');
    io.emit(dir, 'b.ts');

    expect(onChange).not.toHaveBeenCalled(); // nothing before the quiet window elapses

    vi.advanceTimersByTime(50);

    expect(onChange).toHaveBeenCalledTimes(2); // a.ts + b.ts, deduped
    expect(onChange).toHaveBeenCalledWith(`${dir}/a.ts`);
    expect(onChange).toHaveBeenCalledWith(`${dir}/b.ts`);
    vi.useRealTimers();
  });

  it('clear() empties the dirty set and close() stops watchers', async () => {
    const dir = path.resolve('/proj/src');
    const io = createMemoryIo().setDir(dir);
    const watcher = createNfWatcherCore(io, {});

    watcher.addPaths(dir);
    io.emit(dir, 'a.ts');
    expect(watcher.get().size).toBe(1);

    watcher.clear();
    expect(watcher.get().size).toBe(0);

    await watcher.close();
    io.emit(dir, 'b.ts'); // watcher closed → no effect
    expect(watcher.get().size).toBe(0);
  });
});

// A per-file fs.watch handle dies when an editor saves by rename-replace (JetBrains
// "safe write", vim backupcopy=no): the inode it holds is gone and every later edit
// goes unreported. Watching the containing directory survives that.
describe('createNfWatcherCore file watches', () => {
  const dir = path.resolve('/proj/src');
  const a = path.join(dir, 'a.ts');
  const b = path.join(dir, 'b.ts');

  it('watches the containing directory rather than the file itself', () => {
    const io = createMemoryIo().setFile(a, '');
    const spy = vi.spyOn(io, 'watch');

    createNfWatcherCore(io, {}, clock).addPaths(a);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(
      posix(dir),
      expect.objectContaining({ recursive: false }),
      expect.any(Function)
    );
  });

  it('opens one watch for every tracked file sharing a directory', () => {
    const io = createMemoryIo().setFile(a, '').setFile(b, '');
    const spy = vi.spyOn(io, 'watch');

    createNfWatcherCore(io, {}, clock).addPaths([a, b]);

    expect(spy).toHaveBeenCalledTimes(1);
  });

  // The directory reports every entry, so the tracked set has to narrow it back
  // down to the event surface per-file watching had.
  it('ignores events for untracked neighbours in a watched directory', () => {
    const io = createMemoryIo().setFile(a, '').setMtime(a, AGED).setFile(b, '');
    const watcher = createNfWatcherCore(io, {}, clock);

    watcher.addPaths(a);
    io.emit(dir, 'b.ts');
    expect(watcher.get().size).toBe(0);

    io.setMtime(a, NOW);
    io.emit(dir, 'a.ts');
    expect([...watcher.get()]).toEqual([posix(a)]);
  });

  it('reports a file created after it was added', () => {
    const io = createMemoryIo().setDir(dir);
    const watcher = createNfWatcherCore(io, {}, clock);

    watcher.addPaths(a); // does not exist yet — nothing to seed
    io.setFile(a, '').setMtime(a, NOW);
    io.emit(dir, 'a.ts');

    expect([...watcher.get()]).toEqual([posix(a)]);
  });

  it('does not add a second watch when a recursive directory already covers the file', () => {
    const io = createMemoryIo().setDir(dir).setFile(a, '');
    const spy = vi.spyOn(io, 'watch');
    const watcher = createNfWatcherCore(io, {}, clock);

    watcher.addPaths(dir);
    watcher.addPaths(a);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(
      dir,
      expect.objectContaining({ recursive: true }),
      expect.any(Function)
    );
  });

  it('close() stops the directory watches opened for files', async () => {
    const io = createMemoryIo().setFile(a, '').setMtime(a, AGED);
    const watcher = createNfWatcherCore(io, {}, clock);

    watcher.addPaths(a);
    await watcher.close();

    io.setMtime(a, NOW);
    io.emit(dir, 'a.ts');
    expect(watcher.get().size).toBe(0);
  });
});

// macOS FSEvents re-delivers 'changed' for recently edited files roughly every 30s
// with mtime untouched. Once the watch list covers every compiled source, that
// replay alone keeps a rebuild loop awake forever (angular-adapter#96).
describe('createNfWatcherCore replay dedupe', () => {
  const file = path.resolve('/proj/file.ts');
  const seeded = () => createMemoryIo().setFile(file, '').setMtime(file, AGED);

  it('drops a replayed same-mtime event from both channels', () => {
    const io = seeded();
    const onChange = vi.fn();
    const watcher = createNfWatcherCore(io, { onChange }, clock);

    watcher.addPaths(file);
    emitFile(io, file);
    emitFile(io, file);

    expect(onChange).not.toHaveBeenCalled();
    expect(watcher.get().size).toBe(0);
  });

  // Both cases the equality check alone would swallow: a second save inside one
  // mtime tick, and an edit landing between the build and addPaths' seed.
  it('passes an unchanged-mtime event still inside the grace window', () => {
    const io = createMemoryIo()
      .setFile(file, '')
      .setMtime(file, NOW - 500);
    const watcher = createNfWatcherCore(io, {}, clock);

    watcher.addPaths(file);
    emitFile(io, file);

    expect([...watcher.get()]).toEqual([posix(file)]);
  });

  it('passes once the mtime advances, then drops the replay of that event', () => {
    const io = seeded();
    const onChange = vi.fn();
    const watcher = createNfWatcherCore(io, { onChange }, clock);

    watcher.addPaths(file);
    io.setMtime(file, NOW - 30_000);
    emitFile(io, file);
    emitFile(io, file);

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('passes when the file has vanished', () => {
    const io = seeded();
    const watcher = createNfWatcherCore(io, {}, clock);

    watcher.addPaths(file);
    io.remove(file);
    emitFile(io, file);

    expect([...watcher.get()]).toEqual([posix(file)]);
  });

  // Entries of a watched directory are never seeded (that would mean walking the
  // tree), so they seed themselves on the event that first reports them.
  it('passes the first event for an unseeded file under a watched directory', () => {
    const dir = path.resolve('/proj/src');
    const entry = path.join(dir, 'a.ts');
    const io = createMemoryIo().setDir(dir).setFile(entry, '').setMtime(entry, AGED);
    const watcher = createNfWatcherCore(io, {}, clock);

    watcher.addPaths(dir);
    io.emit(dir, 'a.ts');
    expect([...watcher.get()]).toEqual([posix(entry)]);

    watcher.clear();
    io.emit(dir, 'a.ts');
    expect(watcher.get().size).toBe(0);
  });

  // The clock is only consulted when mtime *and* length both match. A save that
  // changed how much it wrote is settled without it, which is what keeps a wrong
  // age (event-loop stall, server-clock skew) from swallowing the common case.
  it('passes an aged same-mtime event whose length changed', () => {
    const io = seeded();
    const watcher = createNfWatcherCore(io, {}, clock);

    watcher.addPaths(file);
    io.setFile(file, 'export const a = 1;\n'); // mtime deliberately left at AGED
    emitFile(io, file);

    expect([...watcher.get()]).toEqual([posix(file)]);
  });

  // A network mount whose server clock runs ahead stamps mtimes in the future, so
  // the age goes negative. That has to read as recent (deliver), not as aged: the
  // dedupe going quiet costs a spurious rebuild, dropping the event costs an edit.
  it('delivers when the mtime is in the future', () => {
    const io = createMemoryIo()
      .setFile(file, '')
      .setMtime(file, NOW + 60_000);
    const watcher = createNfWatcherCore(io, {}, clock);

    watcher.addPaths(file);
    emitFile(io, file);

    expect([...watcher.get()]).toEqual([posix(file)]);
  });

  // Otherwise debounceMs is subtracted from the window: the event below has 100ms
  // of grace left on arrival and none by the time the flush runs.
  it('measures the grace window from event arrival, not from the debounced flush', () => {
    vi.useFakeTimers();
    let t = NOW;
    const io = createMemoryIo()
      .setFile(file, '')
      .setMtime(file, NOW - 1900);
    const onChange = vi.fn();
    const watcher = createNfWatcherCore(io, { onChange, debounceMs: 300 }, () => t);

    watcher.addPaths(file);
    emitFile(io, file);
    t = NOW + 300;
    vi.advanceTimersByTime(300);

    expect(onChange).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('delivers every event when dedupeReplays is off', () => {
    const io = seeded();
    const onChange = vi.fn();
    const watcher = createNfWatcherCore(io, { onChange, dedupeReplays: false }, clock);

    watcher.addPaths(file);
    emitFile(io, file);
    emitFile(io, file);

    expect(onChange).toHaveBeenCalledTimes(2);
  });

  // io.stat is lstat-based: without following the link, an edit to the target is
  // invisible and every event for a symlinked source looks like a replay.
  it('compares the target mtime for a symlinked file', () => {
    const link = path.resolve('/proj/link.ts');
    const target = path.resolve('/dev/lib/real.ts');
    const io = createMemoryIo()
      .setFile(target, '')
      .setSymlink(link, target)
      .setMtime(link, AGED)
      .setMtime(target, AGED);
    const watcher = createNfWatcherCore(io, {}, clock);

    watcher.addPaths(link);
    io.setMtime(target, NOW - 10_000); // target edited; the link's own mtime stands

    emitFile(io, link);

    expect([...watcher.get()]).toEqual([posix(link)]);
  });
});

describe('syncNfFileWatcher', () => {
  it('adds non-node_modules cache keys to the watcher', () => {
    const added: string[] = [];
    const watcher = {
      addPaths: (p: string | readonly string[]) =>
        added.push(...(typeof p === 'string' ? [p] : [...p])),
    } as never;

    syncNfFileWatcher(watcher, {
      keys: () => ['/proj/a.ts', '/proj/node_modules/x/index.js'][Symbol.iterator](),
    });

    expect(added).toEqual(['/proj/a.ts']);
  });

  it('adds linked shared dirs alongside the filtered cache keys', () => {
    const added: string[] = [];
    const watcher = {
      addPaths: (p: string | readonly string[]) =>
        added.push(...(typeof p === 'string' ? [p] : [...p])),
    } as never;

    syncNfFileWatcher(
      watcher,
      { keys: () => ['/proj/a.ts', '/proj/node_modules/x/index.js'][Symbol.iterator]() },
      ['/dev/lib/dist']
    );

    expect(added).toEqual(['/proj/a.ts', '/dev/lib/dist']);
  });

  describe('source shapes', () => {
    const collect = (sources: Parameters<typeof syncNfFileWatcher>[1]): string[] => {
      const added: string[] = [];
      const watcher = {
        addPaths: (p: string | readonly string[]) =>
          added.push(...(typeof p === 'string' ? [p] : [...p])),
      } as never;
      syncNfFileWatcher(watcher, sources);
      return added;
    };

    it('reads a Map keyed by input path', () => {
      expect(collect(new Map([['/proj/a.ts', {}]]))).toEqual(['/proj/a.ts']);
    });

    // Arrays expose keys() too, but it yields indices — taking that branch would
    // hand the watcher '0' and '1'.
    it('reads an array of paths rather than its indices', () => {
      expect(collect(['/proj/a.ts', '/proj/node_modules/x/index.js'])).toEqual(['/proj/a.ts']);
    });

    it('reads a Set of paths', () => {
      expect(collect(new Set(['/proj/a.ts']))).toEqual(['/proj/a.ts']);
    });

    it('reads a bare iterable', () => {
      expect(
        collect(
          (function* () {
            yield '/proj/a.ts';
          })()
        )
      ).toEqual(['/proj/a.ts']);
    });
  });
});
