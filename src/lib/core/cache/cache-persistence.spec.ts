import { describe, expect, it, vi } from 'vitest';
import * as crypto from 'crypto';
import {
  cacheEntryCore,
  getChecksumCore,
  getFilename,
  type CacheMetadata,
} from './cache-persistence.js';
import { createMemoryIo } from '../../utils/io/__test-helpers__/memory-io.js';
import { logger } from '../../utils/logger.js';
import type { NormalizedExternalConfig } from '../../domain/config/external-config.contract.js';

const ext = (version?: string) => ({ version }) as NormalizedExternalConfig;

const meta = (over: Partial<CacheMetadata> = {}): CacheMetadata => ({
  checksum: 'abc',
  externals: [],
  files: [],
  ...over,
});

describe('getFilename', () => {
  it('adds a .meta.json suffix', () => {
    expect(getFilename('shared')).toBe('shared.meta.json');
  });

  it('inserts a -dev marker in dev mode', () => {
    expect(getFilename('shared', true)).toBe('shared-dev.meta.json');
  });
});

describe('getChecksumCore', () => {
  const io = createMemoryIo();

  it('is deterministic and independent of key insertion order', () => {
    const a = getChecksumCore(io, { react: ext('18'), rxjs: ext('7') }, '0');
    const b = getChecksumCore(io, { rxjs: ext('7'), react: ext('18') }, '0');
    expect(a).toBe(b);
  });

  it('changes when the dev flag changes', () => {
    const base = { react: ext('18') };
    expect(getChecksumCore(io, base, '0')).not.toBe(getChecksumCore(io, base, '1'));
  });

  it('changes when a version changes', () => {
    expect(getChecksumCore(io, { react: ext('18') }, '0')).not.toBe(
      getChecksumCore(io, { react: ext('19') }, '0')
    );
  });

  it('changes when the builder version changes', () => {
    const base = { react: ext('18') };
    expect(getChecksumCore(io, base, '0', '1.0.0')).not.toBe(
      getChecksumCore(io, base, '0', '1.0.1')
    );
  });

  it('changes when the CJS-export synthesis flag changes', () => {
    const base = { react: ext('18') };
    expect(getChecksumCore(io, base, '0', '1.0.0', true)).not.toBe(
      getChecksumCore(io, base, '0', '1.0.0', false)
    );
  });

  it('matches a hand-computed sha256', () => {
    const expected = crypto
      .createHash('sha256')
      .update('deps:react@18:dev=0:builder=2.0.0:cjs=1')
      .digest('hex');
    expect(getChecksumCore(io, { react: ext('18') }, '0', '2.0.0')).toBe(expected);
  });
});

describe('cacheEntryCore', () => {
  it('round-trips metadata via persist/getMetadata', () => {
    const io = createMemoryIo();
    const entry = cacheEntryCore(io, '/cache', 'x.meta.json');
    entry.persist(meta({ checksum: 'sum1', files: ['a.js'] }));
    expect(entry.getMetadata('sum1')).toEqual(meta({ checksum: 'sum1', files: ['a.js'] }));
  });

  it('returns undefined when the checksum does not match', () => {
    const io = createMemoryIo();
    const entry = cacheEntryCore(io, '/cache', 'x.meta.json');
    entry.persist(meta({ checksum: 'sum1' }));
    expect(entry.getMetadata('other')).toBeUndefined();
  });

  it('returns undefined when the metadata file is missing', () => {
    const entry = cacheEntryCore(createMemoryIo(), '/cache', 'x.meta.json');
    expect(entry.getMetadata('sum1')).toBeUndefined();
  });

  it('copyFiles creates the output dir and copies only existing files', () => {
    const io = createMemoryIo()
      .setFile('/cache/a.js', 'A')
      .setFile('/cache/x.meta.json', JSON.stringify(meta({ files: ['a.js', 'missing.js'] })));
    const entry = cacheEntryCore(io, '/cache', 'x.meta.json');

    entry.copyFiles('/dist');

    expect(io.isFile('/dist/a.js')).toBe(true);
    expect(io.readText('/dist/a.js')).toBe('A');
    expect(io.isFile('/dist/missing.js')).toBe(false);
  });

  it('copyFiles throws when metadata is missing', () => {
    const entry = cacheEntryCore(createMemoryIo(), '/cache', 'x.meta.json');
    expect(() => entry.copyFiles('/dist')).toThrow(/metadata file could not be found/);
  });

  it('clear creates the cache folder when it does not exist', () => {
    const debug = vi.spyOn(logger, 'debug').mockImplementation(() => undefined);
    const io = createMemoryIo();
    cacheEntryCore(io, '/cache', 'x.meta.json').clear();
    expect(io.isDirectory('/cache')).toBe(true);
    expect(debug).toHaveBeenCalled();
  });

  it('clear removes cached files and the metadata file', () => {
    vi.spyOn(logger, 'debug').mockImplementation(() => undefined);
    const io = createMemoryIo()
      .setDir('/cache')
      .setFile('/cache/a.js', 'A')
      .setFile('/cache/x.meta.json', JSON.stringify(meta({ files: ['a.js'] })));
    const entry = cacheEntryCore(io, '/cache', 'x.meta.json');

    entry.clear();

    expect(io.isFile('/cache/a.js')).toBe(false);
    expect(io.isFile('/cache/x.meta.json')).toBe(false);
  });
});
