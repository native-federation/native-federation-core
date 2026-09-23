import { describe, expect, it } from 'vitest';
import { densifyExternals, toDenseSharedInfoFormat } from './densify-externals.js';
import type { SharedInfo, DenseSharedInfo } from '../../domain/core/federation-info.contract.js';
import { CHUNK_PREFIX } from '../../domain/core/chunk.js';

function flat(packageName: string, outFileName: string, overrides: Partial<SharedInfo> = {}): SharedInfo {
  return {
    singleton: true,
    strictVersion: true,
    requiredVersion: '^1.0.0',
    version: '1.2.3',
    packageName,
    outFileName,
    ...overrides,
  };
}

describe('densifyExternals', () => {
  it('collapses a primary + its secondaries into one dense object with correct entries', () => {
    const result = densifyExternals([
      flat('@angular/common', 'common.js'),
      flat('@angular/common/http', 'common-http.js'),
      flat('@angular/common/locales', 'common-locales.js'),
    ]);

    expect(result).toHaveLength(1);
    const dense = result[0] as DenseSharedInfo;
    expect(dense.packageName).toBe('@angular/common');
    expect(dense.entries).toEqual({
      '@angular/common': 'common.js',
      '@angular/common/http': 'common-http.js',
      '@angular/common/locales': 'common-locales.js',
    });
  });

  it('produces a single-key entries map for a single-entry package', () => {
    const result = densifyExternals([flat('tslib', 'tslib.js')]);

    expect(result).toHaveLength(1);
    const dense = result[0] as DenseSharedInfo;
    expect(dense.packageName).toBe('tslib');
    expect(dense.entries).toEqual({ tslib: 'tslib.js' });
  });

  it('densifies shared mapping entries', () => {
    const result = densifyExternals([
      flat('@myorg/utils', 'utils.js'),
      flat('@myorg/utils/testing', 'utils-testing.js'),
    ]);

    expect(result).toHaveLength(1);
    expect((result[0] as DenseSharedInfo).entries).toEqual({
      '@myorg/utils': 'utils.js',
      '@myorg/utils/testing': 'utils-testing.js',
    });
  });

  it('densifies chunk entries keyed by their full chunk name, not the inferred parent', () => {
    const chunk = flat(`${CHUNK_PREFIX}/chunk-ABC123`, 'chunk-ABC123.js', {
      singleton: false,
      strictVersion: false,
      version: '0.0.0',
      requiredVersion: '0.0.0',
    });
    const result = densifyExternals([flat('tslib', 'tslib.js'), chunk]);

    expect(result).toHaveLength(2);
    expect((result[0] as DenseSharedInfo).entries).toEqual({ tslib: 'tslib.js' });
    const denseChunk = result[1] as DenseSharedInfo;
    expect('outFileName' in denseChunk).toBe(false);
    expect(denseChunk.packageName).toBe(`${CHUNK_PREFIX}/chunk-ABC123`);
    expect(denseChunk.entries).toEqual({ [`${CHUNK_PREFIX}/chunk-ABC123`]: 'chunk-ABC123.js' });
  });

  it('preserves chunk metadata when densifying a chunk', () => {
    const chunk = flat(`${CHUNK_PREFIX}/c1`, 'c1.js', {
      singleton: false,
      strictVersion: false,
      version: '0.0.0',
      requiredVersion: '0.0.0',
    });
    const [denseChunk] = densifyExternals([chunk]) as [DenseSharedInfo];

    expect(denseChunk.singleton).toBe(false);
    expect(denseChunk.strictVersion).toBe(false);
    expect(denseChunk.version).toBe('0.0.0');
    expect(denseChunk.requiredVersion).toBe('0.0.0');
  });

  it('treats any package starting with the prefix as a chunk (keyed by its full name)', () => {
    const result = densifyExternals([flat(CHUNK_PREFIX, 'nf-internal.js')]);

    expect(result).toHaveLength(1);
    const dense = result[0] as DenseSharedInfo;
    expect(dense.packageName).toBe(CHUNK_PREFIX);
    expect(dense.entries).toEqual({ [CHUNK_PREFIX]: 'nf-internal.js' });
  });

  it('splits divergent metadata into separate dense objects sharing packageName', () => {
    const result = densifyExternals([
      flat('@angular/common', 'common.js', { version: '1.2.3' }),
      flat('@angular/common/http', 'common-http.js', { version: '9.9.9' }),
    ]);

    expect(result).toHaveLength(2);
    const [a, b] = result as [DenseSharedInfo, DenseSharedInfo];
    expect(a.packageName).toBe('@angular/common');
    expect(b.packageName).toBe('@angular/common');
    expect(a.entries).toEqual({ '@angular/common': 'common.js' });
    expect(b.entries).toEqual({ '@angular/common/http': 'common-http.js' });
    expect(a.version).toBe('1.2.3');
    expect(b.version).toBe('9.9.9');
  });

  // core#145: mappings expanded from '@org/ui/*' with build: 'separate' each get their own bundle.
  it('splits mapping secondaries planned into different bundles', () => {
    const result = densifyExternals([
      flat('@org/ui/button', 'button.js', { bundle: 'mapping-org_ui_button' }),
      flat('@org/ui/card', 'card.js', { bundle: 'mapping-org_ui_card' }),
    ]);

    expect(result).toEqual([
      expect.objectContaining({ bundle: 'mapping-org_ui_button', entries: { '@org/ui/button': 'button.js' } }),
      expect.objectContaining({ bundle: 'mapping-org_ui_card', entries: { '@org/ui/card': 'card.js' } }),
    ]);
  });

  it('splits a separate mapping from one left in the default mapping bundle', () => {
    const result = densifyExternals([
      flat('@org/ui/button', 'button.js', { bundle: 'mapping-org_ui_button' }),
      flat('@org/ui/card', 'card.js', { bundle: 'mapping-bundle' }),
    ]);

    expect(result.map(r => r.bundle)).toEqual(['mapping-org_ui_button', 'mapping-bundle']);
  });

  it('splits external secondaries planned into different bundles but merges those sharing one', () => {
    const result = densifyExternals([
      flat('rxjs', 'rxjs.js', { bundle: 'browser-rxjs' }),
      flat('rxjs/operators', 'rxjs-operators.js', { bundle: 'browser-rxjs_operators' }),
      flat('rxjs/ajax', 'rxjs-ajax.js', { bundle: 'browser-rxjs' }),
    ]);

    expect(result).toEqual([
      expect.objectContaining({
        bundle: 'browser-rxjs',
        entries: { rxjs: 'rxjs.js', 'rxjs/ajax': 'rxjs-ajax.js' },
      }),
      expect.objectContaining({
        bundle: 'browser-rxjs_operators',
        entries: { 'rxjs/operators': 'rxjs-operators.js' },
      }),
    ]);
  });

  it('splits secondaries in different pools', () => {
    const result = densifyExternals([
      flat('rxjs', 'rxjs.js', { pool: 'a' }),
      flat('rxjs/operators', 'rxjs-operators.js', { pool: 'b' }),
    ]);

    expect(result.map(r => r.pool)).toEqual(['a', 'b']);
  });

  // Guards the denylist: a field the densifier does not know about must not be silently merged.
  it('splits on a metadata field it has no special handling for', () => {
    const result = densifyExternals([
      flat('rxjs', 'rxjs.js', { future: 1 } as Partial<SharedInfo>),
      flat('rxjs/operators', 'rxjs-operators.js', { future: 2 } as Partial<SharedInfo>),
    ]);

    expect(result).toHaveLength(2);
  });

  it('groups entries whose optional fields were added in a different order', () => {
    const a = { ...flat('rxjs', 'rxjs.js'), bundle: 'browser-shared', pool: 'p' };
    const b = { ...flat('rxjs/operators', 'rxjs-operators.js'), pool: 'p', bundle: 'browser-shared' };

    expect(densifyExternals([a, b])).toHaveLength(1);
  });

  it('keeps the first dev hint when merging, without letting it split the group', () => {
    const result = densifyExternals([
      flat('rxjs', 'rxjs.js', { dev: { entryPoint: 'rxjs/index.js' } }),
      flat('rxjs/operators', 'rxjs-operators.js', { dev: { entryPoint: 'rxjs/operators/index.js' } }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]!.dev).toEqual({ entryPoint: 'rxjs/index.js' });
  });

  it('never emits outFileName on a dense object and never entries on a flat one', () => {
    const chunk = flat(`${CHUNK_PREFIX}/chunk-x`, 'chunk-x.js');
    const result = densifyExternals([flat('tslib', 'tslib.js'), chunk]);

    for (const entry of result) {
      if ('entries' in entry) {
        expect('outFileName' in entry).toBe(false);
      } else {
        expect('entries' in entry).toBe(false);
      }
    }
  });

  it('passes already-dense entries through unchanged', () => {
    const dense: DenseSharedInfo = {
      singleton: true,
      strictVersion: true,
      requiredVersion: '^1.0.0',
      packageName: 'rxjs',
      entries: { rxjs: 'rxjs.js', 'rxjs/operators': 'rxjs-operators.js' },
    };
    const result = densifyExternals([dense]);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(dense);
  });

  it('preserves first-seen order across mixed dense groups and chunks', () => {
    const chunk = flat(`${CHUNK_PREFIX}/c1`, 'c1.js');
    const result = densifyExternals([
      flat('tslib', 'tslib.js'),
      chunk,
      flat('@angular/common', 'common.js'),
      flat('@angular/common/http', 'common-http.js'),
    ]);

    expect(result.map(r => ('entries' in r ? Object.keys(r.entries)[0] : r.packageName))).toEqual([
      'tslib',
      `${CHUNK_PREFIX}/c1`,
      '@angular/common',
    ]);
  });
});

describe('toDenseSharedInfoFormat', () => {
  it('converts each flat entry to its own dense object keyed by its packageName', () => {
    const result = toDenseSharedInfoFormat([
      flat('tslib', 'tslib.js'),
      flat('rxjs', 'rxjs.js'),
    ]);

    expect(result).toEqual([
      {
        singleton: true,
        strictVersion: true,
        requiredVersion: '^1.0.0',
        version: '1.2.3',
        packageName: 'tslib',
        entries: { tslib: 'tslib.js' },
      },
      {
        singleton: true,
        strictVersion: true,
        requiredVersion: '^1.0.0',
        version: '1.2.3',
        packageName: 'rxjs',
        entries: { rxjs: 'rxjs.js' },
      },
    ]);
  });

  it('does NOT group secondaries under a parent (unlike densifyExternals)', () => {
    const result = toDenseSharedInfoFormat([
      flat('@angular/common', 'common.js'),
      flat('@angular/common/http', 'common-http.js'),
    ]);

    expect(result).toHaveLength(2);
    expect(result[0].packageName).toBe('@angular/common');
    expect(result[0].entries).toEqual({ '@angular/common': 'common.js' });
    expect(result[1].packageName).toBe('@angular/common/http');
    expect(result[1].entries).toEqual({ '@angular/common/http': 'common-http.js' });
  });

  it('strips outFileName off the produced dense object', () => {
    const [dense] = toDenseSharedInfoFormat([flat('tslib', 'tslib.js')]);

    expect('outFileName' in dense).toBe(false);
    expect('entries' in dense).toBe(true);
  });

  it('passes already-dense entries through unchanged', () => {
    const dense: DenseSharedInfo = {
      singleton: true,
      strictVersion: true,
      requiredVersion: '^1.0.0',
      packageName: 'rxjs',
      entries: { rxjs: 'rxjs.js', 'rxjs/operators': 'rxjs-operators.js' },
    };
    const result = toDenseSharedInfoFormat([dense]);

    expect(result).toHaveLength(1);
    expect(result[0]).toBe(dense);
  });

  it('handles a mix of flat and already-dense entries, preserving order', () => {
    const dense: DenseSharedInfo = {
      singleton: true,
      strictVersion: true,
      requiredVersion: '^1.0.0',
      packageName: 'rxjs',
      entries: { rxjs: 'rxjs.js' },
    };
    const result = toDenseSharedInfoFormat([flat('tslib', 'tslib.js'), dense]);

    expect(result).toHaveLength(2);
    expect(result[0].entries).toEqual({ tslib: 'tslib.js' });
    expect(result[1]).toBe(dense);
  });

  it('returns an empty array for empty input', () => {
    expect(toDenseSharedInfoFormat([])).toEqual([]);
  });
});
