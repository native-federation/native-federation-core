import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as path from 'path';
import { getConfigContext, usePackageJson, useWorkspace } from './configuration-context.js';
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
});
