import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as path from 'path';
import {
  getConfigContext,
  loadWithConfigContext,
  usePackageJson,
  useWorkspace,
} from './configuration-context.js';
import { createMemoryIo } from '../utils/io/__test-helpers__/memory-io.js';

describe('configuration-context', () => {
  // The context is module-level singleton state; reset it around each test.
  beforeEach(() => {
    useWorkspace('');
    usePackageJson(undefined);
  });

  afterEach(() => {
    useWorkspace('');
    usePackageJson(undefined);
  });

  it('stores the workspace root', () => {
    useWorkspace('/ws/root');
    expect(getConfigContext().workspaceRoot).toBe('/ws/root');
  });

  it('stores the package.json path', () => {
    usePackageJson('/ws/root/package.json');
    expect(getConfigContext().packageJson).toBe('/ws/root/package.json');
  });

  it('merges updates instead of replacing the whole context', () => {
    useWorkspace('/ws/root');
    usePackageJson('/ws/root/package.json');

    expect(getConfigContext()).toEqual({
      workspaceRoot: '/ws/root',
      packageJson: '/ws/root/package.json',
    });
  });

  // Nx reports workspaceRoot with whatever drive-letter case the invoking shell used; the
  // sharedMappings keys derive from cwd(). Storing the disk spelling keeps the two comparable.
  it('stores the on-disk spelling of the workspace root', () => {
    const io = createMemoryIo().setDiskCase('c:/ws', 'C:/ws');
    useWorkspace('c:/ws', io);
    expect(getConfigContext().workspaceRoot).toBe(path.normalize('C:/ws'));
  });

  it('overwrites a previously set value on a subsequent call', () => {
    useWorkspace('/ws/first');
    useWorkspace('/ws/second');
    expect(getConfigContext().workspaceRoot).toBe('/ws/second');
  });

  it('allows clearing the package.json path with undefined', () => {
    usePackageJson('/ws/root/package.json');
    usePackageJson(undefined);
    expect(getConfigContext().packageJson).toBeUndefined();
  });

  describe('loadWithConfigContext', () => {
    // A config module reads the context while it evaluates, which happens after an await. Two
    // unqueued loads would both evaluate after the second one set the context.
    it('gives each concurrent load its own context', async () => {
      const io = createMemoryIo();
      const seen: Record<string, string | undefined> = {};
      const load = (name: string) => async () => {
        await new Promise(resolve => setTimeout(resolve, 0));
        seen[name] = getConfigContext().workspaceRoot;
        return name;
      };

      const results = await Promise.all([
        loadWithConfigContext({ workspaceRoot: '/a' }, load('a'), io),
        loadWithConfigContext({ workspaceRoot: '/b' }, load('b'), io),
      ]);

      expect(results).toEqual(['a', 'b']);
      expect(seen).toEqual({ a: '/a', b: '/b' });
    });

    it('does not let a failed load block the next one', async () => {
      const io = createMemoryIo();
      const failed = loadWithConfigContext(
        { workspaceRoot: '/a' },
        async () => {
          throw new Error('broken config');
        },
        io
      );
      const next = loadWithConfigContext({ workspaceRoot: '/b' }, async () => 'b', io);

      await expect(failed).rejects.toThrow('broken config');
      await expect(next).resolves.toBe('b');
    });

    // packageJson is replaced, not merged, so one project's package.json does not leak into a
    // load that has none.
    it('clears a packageJson the previous load set', async () => {
      const io = createMemoryIo();
      await loadWithConfigContext(
        { workspaceRoot: '/a', packageJson: '/a/package.json' },
        async () => undefined,
        io
      );

      const seen = await loadWithConfigContext(
        { workspaceRoot: '/b' },
        async () => getConfigContext(),
        io
      );

      expect(seen).toEqual({ workspaceRoot: '/b', packageJson: undefined });
    });
  });
});
