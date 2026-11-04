import { afterAll, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { toDiskCase, toDiskCaseCore } from './disk-case.js';
import { createMemoryIo } from './io/__test-helpers__/memory-io.js';
import type { FileReaderPort } from '../domain/utils/io-port.contract.js';

// The reported bug is Windows-only, so the fixtures use drive-letter paths. memory-io keys
// them verbatim, which lets the case-only distinction survive a case-sensitive CI host.
const reporting = (spelling: string): FileReaderPort =>
  ({ realpathNative: () => spelling }) as unknown as FileReaderPort;

describe('toDiskCaseCore', () => {
  it('corrects a case-only difference', () => {
    const io = createMemoryIo().setDiskCase('c:/ws', 'C:/ws');
    expect(toDiskCaseCore(io, 'c:/ws')).toBe(path.normalize('C:/ws'));
  });

  it('accepts a correction that also differs in separator style', () => {
    expect(toDiskCaseCore(reporting('C:/ws'), 'c:\\ws')).toBe(path.normalize('C:/ws'));
  });

  it('is a no-op when input and on-disk spelling already agree', () => {
    const root = path.resolve('/ws');
    expect(toDiskCaseCore(reporting(root), root)).toBe(root);
  });

  // pnpm, npm link and preserveSymlinks all rely on the caller's own spelling being kept.
  it('returns the input unchanged when a symlink resolves to a different path', () => {
    const io = createMemoryIo().setSymlink('/ws/libs/ui', '/ws/packages/ui');
    expect(toDiskCaseCore(io, '/ws/libs/ui')).toBe('/ws/libs/ui');
  });

  // The adapter returns the input on ENOENT, and a platform reporting a '\\?\' prefix or a
  // substituted drive lands here too: more than case differs, so nothing is applied.
  it('returns the input unchanged when the reported spelling differs by more than case', () => {
    expect(toDiskCaseCore(reporting('\\\\?\\C:\\ws'), 'c:/ws')).toBe('c:/ws');
  });

  // A path that does not exist, and an empty root, both come back identical from the
  // adapter; normalizing them anyway would turn '' into '.'.
  it('returns an unchanged reported spelling verbatim', () => {
    expect(toDiskCaseCore(reporting(''), '')).toBe('');
    expect(toDiskCaseCore(reporting('c:/ws'), 'c:/ws')).toBe('c:/ws');
  });

  it('ignores a trailing slash on either side', () => {
    expect(toDiskCaseCore(reporting('C:/ws'), 'c:/ws/')).toBe(path.normalize('C:/ws'));
  });
});

// The adapters call this before core runs (core#157), against the real filesystem: these pin what
// their copies relied on rather than the logic, which the suite above covers through the port.
describe('toDiskCase', () => {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'nf-DiskCase-')));
  const dir = path.join(root, 'Workspace');
  fs.mkdirSync(dir);
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  // Mixed case in the temp name makes this a probe for the host's filesystem.
  const caseInsensitive = fs.existsSync(dir.toLowerCase());

  it('returns a path that does not exist unchanged', () => {
    const missing = path.join(root, 'missing', 'Child');
    expect(toDiskCase(missing)).toBe(missing);
  });

  it('returns an existing path in its on-disk spelling unchanged', () => {
    expect(toDiskCase(dir)).toBe(dir);
  });

  it('keeps the spelling of a symlink rather than its target', () => {
    const link = path.join(root, 'link');
    fs.symlinkSync(dir, link, 'junction');
    expect(toDiskCase(link)).toBe(link);
  });

  it.runIf(caseInsensitive)('corrects a case-only difference to the on-disk spelling', () => {
    expect(toDiskCase(dir.toLowerCase())).toBe(dir);
  });
});
