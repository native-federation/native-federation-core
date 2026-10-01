import { describe, expect, it, vi } from 'vitest';
import * as crypto from 'crypto';
import * as path from 'path';
import {
  cacheEntryCore,
  getChecksumCore,
  getFilename,
  prepareCacheCore,
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

  it('changes when any single feature flag flips', () => {
    const base = { react: ext('18') };
    const flags = {
      mappingVersion: false,
      ignoreUnusedDeps: false,
      denseChunking: false,
      denseExternals: false,
      integrityHashes: false,
      synthesizeCjsExports: false,
    };
    const allOff = getChecksumCore(io, base, '0', '1.0.0', flags);

    for (const flag of Object.keys(flags) as Array<keyof typeof flags>) {
      expect(getChecksumCore(io, base, '0', '1.0.0', { ...flags, [flag]: true })).not.toBe(allOff);
    }
  });

  // A flag present-and-false must not hash like a flag absent: adding a flag to the contract has
  // to invalidate, even when it defaults off.
  it('distinguishes an explicitly disabled flag from an absent one', () => {
    const base = { react: ext('18') };
    expect(getChecksumCore(io, base, '0', '1.0.0', { denseChunking: false })).not.toBe(
      getChecksumCore(io, base, '0', '1.0.0', {})
    );
  });

  // These five reach remoteEntry.json via buildResult, and a cache hit replays the recorded
  // externals verbatim — so each has to invalidate or the runtime gets stale negotiation metadata.
  describe.each([
    ['requiredVersion', { requiredVersion: '^2.0.0' }, { requiredVersion: '>=2.0.0' }],
    ['singleton', { singleton: true }, { singleton: false }],
    ['strictVersion', { strictVersion: true }, { strictVersion: false }],
    ['shareScope', { shareScope: 'a' }, { shareScope: 'b' }],
    ['pool', { pool: 'critical' }, { pool: 'lazy' }],
  ])('shared-info field %s', (_field, left, right) => {
    it('changes the checksum when it changes', () => {
      const at = (over: Partial<NormalizedExternalConfig>) =>
        getChecksumCore(io, { react: { ...ext('18'), ...over } }, '0');

      expect(at(left)).not.toBe(at(right));
    });

    it('is stable when it does not', () => {
      const at = (over: Partial<NormalizedExternalConfig>) =>
        getChecksumCore(io, { react: { ...ext('18'), ...over } }, '0');

      expect(at(left)).toBe(at(left));
    });
  });

  // `singleton: false` and an absent `singleton` mean different things downstream, so they must
  // not collide the way a plain falsy check would make them.
  it('distinguishes an explicitly false shared-info field from an absent one', () => {
    expect(getChecksumCore(io, { react: { ...ext('18'), singleton: false } }, '0')).not.toBe(
      getChecksumCore(io, { react: ext('18') }, '0')
    );
  });

  it('is independent of feature-flag key insertion order', () => {
    const base = { react: ext('18') };
    expect(
      getChecksumCore(io, base, '0', '1.0.0', { denseChunking: true, mappingVersion: false })
    ).toBe(getChecksumCore(io, base, '0', '1.0.0', { mappingVersion: false, denseChunking: true }));
  });

  it('matches a hand-computed sha256', () => {
    const expected = crypto
      .createHash('sha256')
      .update('deps:react@18:dev=0:builder=2.0.0:features=denseChunking=1,mappingVersion=0')
      .digest('hex');
    expect(
      getChecksumCore(io, { react: ext('18') }, '0', '2.0.0', {
        mappingVersion: false,
        denseChunking: true,
      })
    ).toBe(expected);
  });

  // Registry-dep regression guard: an empty content-signal map must not perturb the hash.
  it('is byte-identical whether contentSignals is omitted or empty', () => {
    const base = { react: ext('18') };
    expect(getChecksumCore(io, base, '0', '2.0.0', {}, {})).toBe(
      getChecksumCore(io, base, '0', '2.0.0')
    );
  });

  it('changes when a content signal is added for a (linked) package', () => {
    const base = { '@scope/lib': ext('1.0.0') };
    expect(getChecksumCore(io, base, '0', '', {}, { '@scope/lib': '111' })).not.toBe(
      getChecksumCore(io, base, '0')
    );
  });

  it('is byte-identical whether resolvedVersions is omitted or empty', () => {
    const base = { react: ext('18') };
    expect(getChecksumCore(io, base, '0', '2.0.0', {}, {}, {})).toBe(
      getChecksumCore(io, base, '0', '2.0.0')
    );
  });

  // The bug this guards: with shareAll the declared version is absent from `shared`, so the
  // installed version is the only thing that can distinguish two builds.
  it('changes when the installed version changes and the declared one does not', () => {
    const base = { react: ext() };
    expect(getChecksumCore(io, base, '0', '', {}, {}, { react: '18.0.0' })).not.toBe(
      getChecksumCore(io, base, '0', '', {}, {}, { react: '18.0.8' })
    );
  });

  // One slot, but a distinct sigil per source: a key that goes from unresolvable-with-a-declared
  // range to actually installed at that same string must still invalidate.
  it('distinguishes a declared version from the same string as an installed one', () => {
    expect(getChecksumCore(io, { react: ext('18.0.0') }, '0')).not.toBe(
      getChecksumCore(io, { react: ext() }, '0', '', {}, {}, { react: '18.0.0' })
    );
  });

  it('changes when a content signal changes but is stable when it does not', () => {
    const base = { '@scope/lib': ext('1.0.0') };
    const a = getChecksumCore(io, base, '0', '', {}, { '@scope/lib': '111' });
    const b = getChecksumCore(io, base, '0', '', {}, { '@scope/lib': '222' });
    const aAgain = getChecksumCore(io, base, '0', '', {}, { '@scope/lib': '111' });
    expect(a).not.toBe(b);
    expect(a).toBe(aAgain);
  });
});

describe('cacheEntryCore', () => {
  it('keeps the metadata in the cache root and the artifacts in a folder per bundle', () => {
    expect(cacheEntryCore(createMemoryIo(), '/cache', 'browser-shared').dir).toBe(
      path.join('/cache', 'browser-shared')
    );
    expect(cacheEntryCore(createMemoryIo(), '/cache', 'browser-shared', true).dir).toBe(
      path.join('/cache', 'browser-shared-dev')
    );
  });

  it('round-trips metadata via persist/getMetadata', () => {
    const io = createMemoryIo();
    const entry = cacheEntryCore(io, '/cache', 'x');
    entry.persist(meta({ checksum: 'sum1', files: ['a.js'] }));
    expect(io.isFile('/cache/x.meta.json')).toBe(true);
    expect(entry.getMetadata('sum1')).toEqual(meta({ checksum: 'sum1', files: ['a.js'] }));
  });

  it('returns undefined when the checksum does not match', () => {
    const io = createMemoryIo();
    const entry = cacheEntryCore(io, '/cache', 'x');
    entry.persist(meta({ checksum: 'sum1' }));
    expect(entry.getMetadata('other')).toBeUndefined();
  });

  it('returns undefined when the metadata file is missing', () => {
    const entry = cacheEntryCore(createMemoryIo(), '/cache', 'x');
    expect(entry.getMetadata('sum1')).toBeUndefined();
  });

  it('copyFiles creates the output dir and copies the recorded files from the bundle folder', () => {
    const io = createMemoryIo()
      .setFile('/cache/x/a.js', 'A')
      .setFile('/cache/x.meta.json', JSON.stringify(meta({ files: ['a.js'] })));
    const entry = cacheEntryCore(io, '/cache', 'x');

    entry.copyFiles('/dist');

    expect(io.isFile('/dist/a.js')).toBe(true);
    expect(io.readText('/dist/a.js')).toBe('A');
  });

  // A reaped cache used to degrade into a silently incomplete dist.
  it('copyFiles throws when a recorded file is missing from the cache', () => {
    const io = createMemoryIo()
      .setFile('/cache/x/a.js', 'A')
      .setFile('/cache/x.meta.json', JSON.stringify(meta({ files: ['a.js', 'missing.js'] })));
    const entry = cacheEntryCore(io, '/cache', 'x');

    expect(() => entry.copyFiles('/dist')).toThrow(/'missing\.js'.*is missing/);
  });

  it('copyFiles throws when metadata is missing', () => {
    const entry = cacheEntryCore(createMemoryIo(), '/cache', 'x');
    expect(() => entry.copyFiles('/dist')).toThrow(/metadata file could not be found/);
  });

  it('clear creates the bundle folder when it does not exist', () => {
    vi.spyOn(logger, 'debug').mockImplementation(() => undefined);
    const io = createMemoryIo();
    cacheEntryCore(io, '/cache', 'x').clear();
    expect(io.isDirectory('/cache/x')).toBe(true);
  });

  it('clear removes the bundle folder, including files the metadata does not list, and the metadata file', () => {
    vi.spyOn(logger, 'debug').mockImplementation(() => undefined);
    const io = createMemoryIo()
      .setFile('/cache/x/a.js', 'A')
      .setFile('/cache/x/.nf-cjs-entries/e.js', 'E')
      .setFile('/cache/x.meta.json', JSON.stringify(meta({ files: ['a.js'] })));

    cacheEntryCore(io, '/cache', 'x').clear();

    expect(io.isFile('/cache/x/a.js')).toBe(false);
    expect(io.isFile('/cache/x/.nf-cjs-entries/e.js')).toBe(false);
    expect(io.isFile('/cache/x.meta.json')).toBe(false);
    expect(io.isDirectory('/cache/x')).toBe(true);
  });

  // Before per-bundle folders, two bundles listing one content-named chunk shared the file, and
  // clearing one deleted the other's.
  it("clear leaves another bundle's chunk of the same name alone", () => {
    vi.spyOn(logger, 'debug').mockImplementation(() => undefined);
    const io = createMemoryIo()
      .setFile('/cache/a/graphql-MTXZ34YT.js', 'G')
      .setFile('/cache/a.meta.json', JSON.stringify(meta({ files: ['graphql-MTXZ34YT.js'] })))
      .setFile('/cache/b/graphql-MTXZ34YT.js', 'G')
      .setFile('/cache/b.meta.json', JSON.stringify(meta({ files: ['graphql-MTXZ34YT.js'] })));

    cacheEntryCore(io, '/cache', 'a').clear();

    expect(() => cacheEntryCore(io, '/cache', 'b').copyFiles('/dist')).not.toThrow();
  });
});

describe('prepareCacheCore', () => {
  const stamp = (io: ReturnType<typeof createMemoryIo>) =>
    JSON.parse(io.readText('/cache/.nf-cache.json'));

  it('purges a cache without a stamp, which predates per-bundle folders', () => {
    const io = createMemoryIo()
      .setFile('/cache/shared.meta.json', '{}')
      .setFile('/cache/foo.ABC.js', 'F')
      .setFile('/cache/tsconfig.federation.json', '{}');

    prepareCacheCore(io, '/cache', '4.8.0');

    expect(io.files().filter(f => f.startsWith(path.resolve('/cache')))).toEqual([
      path.resolve('/cache/.nf-cache.json').replace(/\\/g, '/'),
    ]);
    expect(stamp(io)).toEqual({ layout: 2, version: '4.8.0' });
  });

  it('keeps the cache when only the patch version changed', () => {
    const io = createMemoryIo().setFile('/cache/x/a.js', 'A');
    prepareCacheCore(io, '/cache', '4.8.0');
    io.setFile('/cache/x/a.js', 'A');

    prepareCacheCore(io, '/cache', '4.8.3');

    expect(io.isFile('/cache/x/a.js')).toBe(true);
    expect(stamp(io).version).toBe('4.8.0');
  });

  it('purges the cache when the minor version changed', () => {
    const io = createMemoryIo();
    prepareCacheCore(io, '/cache', '4.8.0');
    io.setFile('/cache/x/a.js', 'A');

    prepareCacheCore(io, '/cache', '4.9.0');

    expect(io.isFile('/cache/x/a.js')).toBe(false);
    expect(stamp(io).version).toBe('4.9.0');
  });

  it('purges the cache when the layout changed under the same minor', () => {
    const io = createMemoryIo()
      .setFile('/cache/.nf-cache.json', JSON.stringify({ layout: 1, version: '4.8.0' }))
      .setFile('/cache/x/a.js', 'A');

    prepareCacheCore(io, '/cache', '4.8.0');

    expect(io.isFile('/cache/x/a.js')).toBe(false);
  });

  it('purges the cache when the stamp cannot be parsed', () => {
    const io = createMemoryIo()
      .setFile('/cache/.nf-cache.json', 'not json')
      .setFile('/cache/x/a.js', 'A');

    prepareCacheCore(io, '/cache', '4.8.0');

    expect(io.isFile('/cache/x/a.js')).toBe(false);
  });
});
