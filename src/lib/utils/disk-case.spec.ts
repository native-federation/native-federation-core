import { describe, expect, it } from 'vitest';
import * as path from 'path';
import { toDiskCase } from './disk-case.js';
import { createMemoryIo } from './io/__test-helpers__/memory-io.js';
import type { FileReaderPort } from '../domain/utils/io-port.contract.js';

// The reported bug is Windows-only, so the fixtures use drive-letter paths. memory-io keys
// them verbatim, which lets the case-only distinction survive a case-sensitive CI host.
const reporting = (spelling: string): FileReaderPort =>
  ({ realpathNative: () => spelling }) as unknown as FileReaderPort;

describe('toDiskCase', () => {
  it('corrects a case-only difference', () => {
    const io = createMemoryIo().setDiskCase('c:/ws', 'C:/ws');
    expect(toDiskCase(io, 'c:/ws')).toBe(path.normalize('C:/ws'));
  });

  it('accepts a correction that also differs in separator style', () => {
    expect(toDiskCase(reporting('C:/ws'), 'c:\\ws')).toBe(path.normalize('C:/ws'));
  });

  it('is a no-op when input and on-disk spelling already agree', () => {
    const root = path.resolve('/ws');
    expect(toDiskCase(reporting(root), root)).toBe(root);
  });

  // pnpm, npm link and preserveSymlinks all rely on the caller's own spelling being kept.
  it('returns the input unchanged when a symlink resolves to a different path', () => {
    const io = createMemoryIo().setSymlink('/ws/libs/ui', '/ws/packages/ui');
    expect(toDiskCase(io, '/ws/libs/ui')).toBe('/ws/libs/ui');
  });

  // The adapter returns the input on ENOENT, and a platform reporting a '\\?\' prefix or a
  // substituted drive lands here too: more than case differs, so nothing is applied.
  it('returns the input unchanged when the reported spelling differs by more than case', () => {
    expect(toDiskCase(reporting('\\\\?\\C:\\ws'), 'c:/ws')).toBe('c:/ws');
  });

  // A path that does not exist, and an empty root, both come back identical from the
  // adapter; normalizing them anyway would turn '' into '.'.
  it('returns an unchanged reported spelling verbatim', () => {
    expect(toDiskCase(reporting(''), '')).toBe('');
    expect(toDiskCase(reporting('c:/ws'), 'c:/ws')).toBe('c:/ws');
  });

  it('ignores a trailing slash on either side', () => {
    expect(toDiskCase(reporting('C:/ws'), 'c:/ws/')).toBe(path.normalize('C:/ws'));
  });
});
