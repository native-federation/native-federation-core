import { describe, expect, it } from 'vitest';
import * as crypto from 'crypto';
import {
  hashBuildMetadata,
  hashChunkContent,
  hashEntryContent,
  hashFileCore,
  integrityForFileCore,
} from './hash.js';
import { createMemoryIo } from './io/__test-helpers__/memory-io.js';

const io = createMemoryIo();

const sha256hex = (data: string) => crypto.createHash('sha256').update(data).digest('hex');
const sri = (data: string, algo: 'sha256' | 'sha384' | 'sha512') =>
  `${algo}-${crypto.createHash(algo).update(data).digest('base64')}`;
const dense = (data: string) =>
  crypto
    .createHash('sha256')
    .update(data)
    .digest('base64')
    .replace(/\//g, '_')
    .replace(/\+/g, '-')
    .replace(/=/g, '')
    .substring(0, 10);

describe('hashChunkContent', () => {
  it('fills the requested length in base32', () => {
    // The lengths esbuild, Rollup and a hex-named bundler write into a chunk name.
    for (const length of [8, 10, 16]) {
      const name = hashChunkContent(io, 'export const a = 1;\n', length);
      expect(name).toHaveLength(length);
      expect(name).toMatch(/^[A-Z2-7]+$/);
    }
  });

  it('is a function of the text alone', () => {
    expect(hashChunkContent(io, 'a', 8)).toBe(hashChunkContent(io, 'a', 8));
    expect(hashChunkContent(io, 'a', 8)).not.toBe(hashChunkContent(io, 'b', 8));
  });
});

describe('hashEntryContent and hashBuildMetadata', () => {
  it('produce a 10-char base64url hash', () => {
    for (const hash of [
      hashEntryContent(io, 'export {};'),
      hashBuildMetadata(io, 'react_18.0.0_state'),
    ]) {
      expect(hash).toMatch(/^[A-Za-z0-9_-]{10}$/);
    }
  });

  it('match a hand-computed sha256 base64url hash', () => {
    expect(hashBuildMetadata(io, 'react_18.0.0_state')).toBe(dense('react_18.0.0_state'));
    expect(hashEntryContent(io, 'export {};')).toBe(dense('export {};'));
  });

  it('differ for different inputs', () => {
    expect(hashBuildMetadata(io, 'a')).not.toBe(hashBuildMetadata(io, 'b'));
  });
});

describe('hashFileCore', () => {
  it('returns the sha256 hex digest of the file contents', () => {
    const files = createMemoryIo().setFile('/a.js', 'hello world');
    expect(hashFileCore(files, '/a.js')).toBe(sha256hex('hello world'));
  });

  it('produces identical hashes for identical bytes', () => {
    const files = createMemoryIo().setFile('/a.js', 'same').setFile('/b.js', 'same');
    expect(hashFileCore(files, '/a.js')).toBe(hashFileCore(files, '/b.js'));
  });
});

describe('integrityForFileCore', () => {
  it('defaults to sha384 and formats as "<algo>-<base64>"', () => {
    const files = createMemoryIo().setFile('/a.js', 'payload');
    expect(integrityForFileCore(files, '/a.js')).toBe(sri('payload', 'sha384'));
  });

  it('honours an explicit algorithm', () => {
    const files = createMemoryIo().setFile('/a.js', 'payload');
    expect(integrityForFileCore(files, '/a.js', 'sha256')).toBe(sri('payload', 'sha256'));
    expect(integrityForFileCore(files, '/a.js', 'sha512')).toBe(sri('payload', 'sha512'));
  });
});
