import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { nodeIo } from './node-io-adapter.js';

describe('nodeIo', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'nf-io-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  describe('realpath', () => {
    it('resolves a symlink to its target', () => {
      const target = path.join(root, 'target');
      const link = path.join(root, 'link');
      fs.mkdirSync(target);
      fs.symlinkSync(target, link, 'dir');

      expect(nodeIo.realpath(link)).toBe(fs.realpathSync(target));
    });

    it('returns the input unchanged when the path does not exist', () => {
      const missing = path.join(root, 'nope');
      expect(nodeIo.realpath(missing)).toBe(missing);
    });
  });

  describe('realpathNative', () => {
    it('resolves a symlink to its target', () => {
      const target = path.join(root, 'target');
      const link = path.join(root, 'link');
      fs.mkdirSync(target);
      fs.symlinkSync(target, link, 'dir');

      expect(nodeIo.realpathNative(link)).toBe(fs.realpathSync.native(target));
    });

    it('returns the input unchanged when the path does not exist', () => {
      const missing = path.join(root, 'nope');
      expect(nodeIo.realpathNative(missing)).toBe(missing);
    });
  });

  describe('stat', () => {
    it('flags a symlink without following it', () => {
      const target = path.join(root, 'target');
      const link = path.join(root, 'link');
      fs.mkdirSync(target);
      fs.symlinkSync(target, link, 'dir');

      expect(nodeIo.stat(link)?.isSymbolicLink).toBe(true);
      expect(nodeIo.stat(target)?.isSymbolicLink).toBe(false);
    });

    it('returns null on ENOENT', () => {
      expect(nodeIo.stat(path.join(root, 'nope'))).toBeNull();
    });
  });

  // Pins the glob semantics expand-mappings and resolve-wildcard-keys rely on, and that
  // createMemoryIo mimics; the glob library was swapped once already (angular-adapter#140).
  describe('globFiles', () => {
    const touch = (rel: string) => {
      const file = path.join(root, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, '');
    };
    const glob = (pattern: string, ignore?: string[]) =>
      nodeIo.globFiles(pattern, { cwd: root, ignore }).sort();

    it('returns files at any depth as posix paths relative to cwd', () => {
      touch('libs/ui/index.ts');
      touch('libs/ui/deep/a/b/index.ts');

      expect(glob('libs/**/*')).toEqual(['libs/ui/deep/a/b/index.ts', 'libs/ui/index.ts']);
    });

    it('returns paths sorted, not in walk order', () => {
      // tinyglobby interleaves a directory's files with its subdirectories' contents (fast-glob
      // listed files first); either order leaks into esbuild's chunking, so the port sorts.
      touch('libs/b.ts');
      touch('libs/a/z.ts');
      touch('libs/c/d/e.ts');
      touch('libs/a.ts');

      expect(nodeIo.globFiles('libs/**/*', { cwd: root })).toEqual([
        'libs/a.ts',
        'libs/a/z.ts',
        'libs/b.ts',
        'libs/c/d/e.ts',
      ]);
    });

    it('never returns directories, even when the pattern names one', () => {
      touch('libs/ui/index.ts');

      // A library that expands directories (tinyglobby's default) would return index.ts here.
      expect(glob('libs/ui')).toEqual([]);
      expect(glob('libs/*')).toEqual([]);
    });

    it('honours node_modules ignores', () => {
      touch('libs/ui/index.ts');
      touch('libs/ui/node_modules/lodash/index.ts');

      expect(glob('libs/**/*', ['**/node_modules/**'])).toEqual(['libs/ui/index.ts']);
    });

    it('skips dotfiles and dot directories', () => {
      touch('libs/ui/index.ts');
      touch('libs/ui/.cache/index.ts');
      touch('libs/ui/.eslintrc.ts');

      expect(glob('libs/**/*')).toEqual(['libs/ui/index.ts']);
    });

    it('follows symlinked directories', () => {
      touch('packages/button/index.ts');
      fs.mkdirSync(path.join(root, 'libs'));
      fs.symlinkSync(path.join(root, 'packages/button'), path.join(root, 'libs/button'), 'dir');

      expect(glob('libs/**/*')).toEqual(['libs/button/index.ts']);
    });

    it("treats a mid-segment '**' as a single-segment wildcard", () => {
      // The same rule createMemoryIo's matcher enforces; see path-patterns.spec.ts.
      touch('libs/ui-button/index.ts');

      expect(glob('libs/ui-**')).toEqual([]);
      expect(glob('libs/ui-**/index.ts')).toEqual(['libs/ui-button/index.ts']);
    });
  });

  describe('watch (poll)', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('detects an atomic rewrite that changes the inode', () => {
      const file = path.join(root, 'a.js');
      fs.writeFileSync(file, 'v1');

      const seen: (string | null)[] = [];
      const handle = nodeIo.watch(root, { recursive: true, poll: { intervalMs: 100 } }, f =>
        seen.push(f)
      );

      // Atomic replace: write a temp file and rename over the original (new inode).
      const tmp = path.join(root, 'a.js.tmp');
      fs.writeFileSync(tmp, 'v2');
      fs.renameSync(tmp, file);

      vi.advanceTimersByTime(100);
      handle.close();

      expect(seen).toContain('a.js');
    });

    // `npm link` points at the package root, so the linked lib's own installed deps sit
    // inside the polled dir; walking them every 300ms is what starves the loop.
    it('does not descend into the linked package own node_modules', () => {
      fs.writeFileSync(path.join(root, 'index.js'), 'v1');
      fs.mkdirSync(path.join(root, 'node_modules', 'dep'), { recursive: true });
      const vendored = path.join(root, 'node_modules', 'dep', 'index.js');
      fs.writeFileSync(vendored, 'v1');

      const seen: (string | null)[] = [];
      const handle = nodeIo.watch(root, { recursive: true, poll: { intervalMs: 100 } }, f =>
        seen.push(f)
      );

      fs.writeFileSync(vendored, 'v2-changed');
      vi.advanceTimersByTime(100);

      expect(seen).toEqual([]);

      // the package's own files are still watched
      fs.writeFileSync(path.join(root, 'index.js'), 'v2-changed');
      vi.advanceTimersByTime(100);
      handle.close();

      expect(seen).toContain('index.js');
    });
  });
});
