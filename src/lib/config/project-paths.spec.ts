import { afterEach, describe, expect, it } from 'vitest';
import * as path from 'path';
import { cwd } from 'process';
import { findMappingsTsConfigCore, findRootTsConfigJsonCore } from './project-paths.js';
import { createMemoryIo } from '../utils/io/__test-helpers__/memory-io.js';
import { usePackageJson, useTsConfig, useWorkspace } from './configuration-context.js';

const ROOT = cwd();

describe('findRootTsConfigJsonCore', () => {
  const withPackageJson = () => createMemoryIo().setFile(path.join(ROOT, 'package.json'), '{}');

  it('prefers tsconfig.base.json when both exist', () => {
    const io = withPackageJson()
      .setFile(path.join(ROOT, 'tsconfig.base.json'), '{}')
      .setFile(path.join(ROOT, 'tsconfig.json'), '{}');
    expect(findRootTsConfigJsonCore(io)).toBe(path.join(ROOT, 'tsconfig.base.json'));
  });

  it('falls back to tsconfig.json when no base config exists', () => {
    const io = withPackageJson().setFile(path.join(ROOT, 'tsconfig.json'), '{}');
    expect(findRootTsConfigJsonCore(io)).toBe(path.join(ROOT, 'tsconfig.json'));
  });

  it('throws when neither config is present', () => {
    expect(() => findRootTsConfigJsonCore(withPackageJson())).toThrow(/Neither a tsconfig/);
  });

  // The mirror image of the Nx case bug: cwd() is the mis-cased side. The returned path
  // seeds every sharedMappings key, so it has to agree with the workspace root.
  it('returns the on-disk spelling when cwd() is mis-cased', () => {
    const disk = path.join(path.dirname(ROOT), path.basename(ROOT).toUpperCase());
    const io = createMemoryIo()
      .setDiskCase(ROOT, disk)
      .setFile(path.join(disk, 'package.json'), '{}')
      .setFile(path.join(disk, 'tsconfig.base.json'), '{}');

    expect(findRootTsConfigJsonCore(io)).toBe(path.join(disk, 'tsconfig.base.json'));
  });

  // core#156: a build run from outside the workspace. The workspace root is set by
  // normalizeFederationOptions before the config (and so this lookup) is evaluated.
  describe('with a workspace root in the context', () => {
    const WS = path.resolve('/elsewhere/ws');

    afterEach(() => {
      useWorkspace('');
      usePackageJson(undefined);
    });

    it('falls back to workspaceRoot when no package.json is above cwd', () => {
      const io = createMemoryIo()
        .setFile(path.join(WS, 'package.json'), '{}')
        .setFile(path.join(WS, 'tsconfig.json'), '{}');
      useWorkspace(WS, io);

      expect(findRootTsConfigJsonCore(io)).toBe(path.join(WS, 'tsconfig.json'));
    });

    // An unrelated package.json above cwd (a home dir) has no tsconfig next to it.
    it('falls back to workspaceRoot when the package.json above cwd has no tsconfig', () => {
      const io = withPackageJson()
        .setFile(path.join(WS, 'package.json'), '{}')
        .setFile(path.join(WS, 'tsconfig.json'), '{}');
      useWorkspace(WS, io);

      expect(findRootTsConfigJsonCore(io)).toBe(path.join(WS, 'tsconfig.json'));
    });

    // A monorepo root's tsconfig.base.json carries the paths; a subproject's tsconfig.json may
    // not extend it, so the cwd resolution must not move.
    it('keeps the tsconfig found from cwd', () => {
      const io = withPackageJson()
        .setFile(path.join(ROOT, 'tsconfig.base.json'), '{}')
        .setFile(path.join(WS, 'package.json'), '{}')
        .setFile(path.join(WS, 'tsconfig.json'), '{}');
      useWorkspace(WS, io);

      expect(findRootTsConfigJsonCore(io)).toBe(path.join(ROOT, 'tsconfig.base.json'));
    });

    it('throws when workspaceRoot has no tsconfig either', () => {
      const io = createMemoryIo().setFile(path.join(WS, 'package.json'), '{}');
      useWorkspace(WS, io);

      expect(() => findRootTsConfigJsonCore(io)).toThrow(/Neither a tsconfig/);
    });
  });

  it('rethrows the cwd error without a workspace root in the context', () => {
    expect(() => findRootTsConfigJsonCore(createMemoryIo())).toThrow(/no package.json found/);
  });
});

// core#149: shared mappings come from the tsconfig the build compiles with.
describe('findMappingsTsConfigCore', () => {
  const WS = path.resolve('/ws');

  afterEach(() => {
    useWorkspace('');
    usePackageJson(undefined);
    useTsConfig(undefined);
  });

  it('resolves the build tsconfig against the workspace root', () => {
    const io = createMemoryIo().setFile(path.join(WS, 'apps/shell/tsconfig.federation.json'), '{}');
    useWorkspace(WS, io);
    useTsConfig('apps/shell/tsconfig.federation.json');

    expect(findMappingsTsConfigCore(io)).toBe(path.join(WS, 'apps/shell/tsconfig.federation.json'));
  });

  it('keeps an absolute build tsconfig', () => {
    const abs = path.resolve('/elsewhere/tsconfig.app.json');
    const io = createMemoryIo().setFile(abs, '{}');
    useWorkspace(WS, io);
    useTsConfig(abs);

    expect(findMappingsTsConfigCore(io)).toBe(abs);
  });

  it('throws when the build tsconfig does not exist', () => {
    const io = createMemoryIo();
    useWorkspace(WS, io);
    useTsConfig('apps/shell/tsconfig.federation.json');

    expect(() => findMappingsTsConfigCore(io)).toThrow(/does not exist/);
  });

  it('falls back to the root tsconfig without a build tsconfig', () => {
    const io = createMemoryIo()
      .setFile(path.join(ROOT, 'package.json'), '{}')
      .setFile(path.join(ROOT, 'tsconfig.json'), '{}');

    expect(findMappingsTsConfigCore(io)).toBe(path.join(ROOT, 'tsconfig.json'));
  });
});
