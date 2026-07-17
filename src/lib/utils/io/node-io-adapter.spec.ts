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
  });
});
