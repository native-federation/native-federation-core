import { describe, expect, it } from 'vitest';
import * as crypto from 'crypto';
import { hashFileCore, integrityForFileCore } from './hash-file.js';
import { createMemoryIo } from './io/__test-helpers__/memory-io.js';

const md5 = (data: string) => crypto.createHash('md5').update(data).digest('hex');
const sri = (data: string, algo: 'sha256' | 'sha384' | 'sha512') =>
  `${algo}-${crypto.createHash(algo).update(data).digest('base64')}`;

describe('hashFileCore', () => {
  it('returns the md5 hex digest of the file contents', () => {
    const io = createMemoryIo().setFile('/a.js', 'hello world');
    expect(hashFileCore(io, '/a.js')).toBe(md5('hello world'));
  });

  it('produces identical hashes for identical bytes', () => {
    const io = createMemoryIo().setFile('/a.js', 'same').setFile('/b.js', 'same');
    expect(hashFileCore(io, '/a.js')).toBe(hashFileCore(io, '/b.js'));
  });
});

describe('integrityForFileCore', () => {
  it('defaults to sha384 and formats as "<algo>-<base64>"', () => {
    const io = createMemoryIo().setFile('/a.js', 'payload');
    expect(integrityForFileCore(io, '/a.js')).toBe(sri('payload', 'sha384'));
  });

  it('honours an explicit algorithm', () => {
    const io = createMemoryIo().setFile('/a.js', 'payload');
    expect(integrityForFileCore(io, '/a.js', 'sha256')).toBe(sri('payload', 'sha256'));
    expect(integrityForFileCore(io, '/a.js', 'sha512')).toBe(sri('payload', 'sha512'));
  });
});
