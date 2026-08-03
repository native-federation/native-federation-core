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
    io.emit(file);

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
    io.emit(file);

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

  it('logs (and swallows) when a path cannot be watched', () => {
    const debug = vi.spyOn(logger, 'debug').mockImplementation(() => undefined);
    const io = createMemoryIo();
    io.watch = () => {
      throw new Error('boom');
    };

    expect(() => createNfWatcherCore(io, {}).addPaths('/nope')).not.toThrow();
    expect(debug).toHaveBeenCalled();
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
    io.emit(file);
    io.emit(file);

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
    io.emit(file);

    expect([...watcher.get()]).toEqual([posix(file)]);
  });

  it('passes once the mtime advances, then drops the replay of that event', () => {
    const io = seeded();
    const onChange = vi.fn();
    const watcher = createNfWatcherCore(io, { onChange }, clock);

    watcher.addPaths(file);
    io.setMtime(file, NOW - 30_000);
    io.emit(file);
    io.emit(file);

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('passes when the file has vanished', () => {
    const io = seeded();
    const watcher = createNfWatcherCore(io, {}, clock);

    watcher.addPaths(file);
    io.remove(file);
    io.emit(file);

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

  it('delivers every event when dedupeReplays is off', () => {
    const io = seeded();
    const onChange = vi.fn();
    const watcher = createNfWatcherCore(io, { onChange, dedupeReplays: false }, clock);

    watcher.addPaths(file);
    io.emit(file);
    io.emit(file);

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

    io.emit(link);

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
