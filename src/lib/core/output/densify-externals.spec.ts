import { describe, expect, it } from 'vitest';
import { densifyExternals } from './densify-externals.js';
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

  it('passes chunk entries through flat, untouched', () => {
    const chunk = flat(`${CHUNK_PREFIX}/chunk-ABC123`, 'chunk-ABC123.js', {
      singleton: false,
      strictVersion: false,
      version: '0.0.0',
      requiredVersion: '0.0.0',
    });
    const result = densifyExternals([flat('tslib', 'tslib.js'), chunk]);

    expect(result).toHaveLength(2);
    // dense external first, chunk passed through unchanged (still flat, identical object)
    expect((result[0] as DenseSharedInfo).entries).toEqual({ tslib: 'tslib.js' });
    expect(result[1]).toEqual(chunk);
    expect('entries' in result[1]!).toBe(false);
    expect((result[1] as SharedInfo).outFileName).toBe('chunk-ABC123.js');
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
