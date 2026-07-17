import { describe, expect, it, vi } from 'vitest';
import * as path from 'path';
import { createNfWatcherCore, syncNfFileWatcher } from './file-watcher.js';
import { createMemoryIo } from './io/__test-helpers__/memory-io.js';
import { logger } from './logger.js';

describe('createNfWatcherCore', () => {
  it('accumulates changed paths in dirtyPaths when no onChange handler is given', () => {
    const dir = path.resolve('/proj/src');
    const io = createMemoryIo().setDir(dir);
    const watcher = createNfWatcherCore(io, {});

    watcher.addPaths(dir);
    io.emit(dir, 'a.ts');

    expect([...watcher.get()]).toEqual([`${dir.replace(/\\/g, '/')}/a.ts`]);
  });

  it('invokes onChange instead of buffering when a handler is provided', () => {
    const file = path.resolve('/proj/file.ts');
    const io = createMemoryIo().setFile(file, '');
    const onChange = vi.fn();
    const watcher = createNfWatcherCore(io, { onChange });

    watcher.addPaths(file);
    io.emit(file);

    expect(onChange).toHaveBeenCalledWith(file.replace(/\\/g, '/'));
    expect(watcher.get().size).toBe(0);
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
});
