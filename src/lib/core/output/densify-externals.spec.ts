import { describe, expect, it } from 'vitest';
import { densifyExternals, toDenseSharedInfoFormat } from './densify-externals.js';
import type { SharedInfo, DenseSharedInfo } from '../../domain/core/federation-info.contract.js';
import { alignPackageVersions } from './align-package-versions.js';
import { inferPackageFromSecondary } from '../../utils/normalize.js';

function flat(
  packageName: string,
  outFileName: string,
  overrides: Partial<SharedInfo> = {}
): SharedInfo {
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

// The build path for shared externals: config is aligned per package when it is read, the version
// here, then grouping.
function densify(shared: SharedInfo[]): DenseSharedInfo[] {
  return densifyExternals(alignPackageVersions(shared, inferPackageFromSecondary), new Map());
}

describe('densifyExternals', () => {
  it('collapses a primary + its secondaries into one dense object with correct entries', () => {
    const result = densifyExternals(
      [
        flat('@angular/common', 'common.js'),
        flat('@angular/common/http', 'common-http.js'),
        flat('@angular/common/locales', 'common-locales.js'),
      ],
      new Map()
    );

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
    const result = densifyExternals([flat('tslib', 'tslib.js')], new Map());

    expect(result).toHaveLength(1);
    const dense = result[0] as DenseSharedInfo;
    expect(dense.packageName).toBe('tslib');
    expect(dense.entries).toEqual({ tslib: 'tslib.js' });
  });

  it('densifies shared mapping entries', () => {
    const result = densifyExternals(
      [flat('@myorg/utils', 'utils.js'), flat('@myorg/utils/testing', 'utils-testing.js')],
      new Map()
    );

    expect(result).toHaveLength(1);
    expect((result[0] as DenseSharedInfo).entries).toEqual({
      '@myorg/utils': 'utils.js',
      '@myorg/utils/testing': 'utils-testing.js',
    });
  });

  // W15: each entry point reads its version from its own package.json; the main entry's wins.
  it("publishes one record with the main entry's version when entry points diverge", () => {
    const result = densify([
      flat('@angular/common/http', 'common-http.js', { version: '9.9.9' }),
      flat('@angular/common', 'common.js', { version: '1.2.3' }),
    ]);

    expect(result).toEqual([
      expect.objectContaining({
        packageName: '@angular/common',
        version: '1.2.3',
        entries: { '@angular/common/http': 'common-http.js', '@angular/common': 'common.js' },
      }),
    ]);
  });

  it('takes the requiredVersion with the version', () => {
    const result = densify([
      flat('@org/lib', 'lib.js', { requiredVersion: '~1.0.0', version: '1.0.0' }),
      flat('@org/lib/testing', 'testing.js', { requiredVersion: '~2.0.0', version: '2.0.0' }),
    ]);

    expect(result.map(r => [r.requiredVersion, r.version, Object.keys(r.entries)])).toEqual([
      ['~1.0.0', '1.0.0', ['@org/lib', '@org/lib/testing']],
    ]);
  });

  it('passes entry points with one version through unchanged', () => {
    const shared = [flat('rxjs', 'rxjs.js'), flat('rxjs/operators', 'rxjs-operators.js')];
    const aligned = alignPackageVersions(shared, inferPackageFromSecondary);

    expect(aligned).toEqual(shared);
    expect(densifyExternals(aligned, new Map())).toHaveLength(1);
  });

  // Guards the denylist: a field the densifier does not know about must not be silently merged.
  it('splits on a metadata field it has no special handling for', () => {
    const result = densifyExternals(
      [
        flat('rxjs', 'rxjs.js', { future: 1 } as Partial<SharedInfo>),
        flat('rxjs/operators', 'rxjs-operators.js', { future: 2 } as Partial<SharedInfo>),
      ],
      new Map()
    );

    expect(result).toHaveLength(2);
  });

  it('groups entries whose optional fields were added in a different order', () => {
    const a = { ...flat('rxjs', 'rxjs.js'), bundle: 'browser-shared', pool: 'p' };
    const b = {
      ...flat('rxjs/operators', 'rxjs-operators.js'),
      pool: 'p',
      bundle: 'browser-shared',
    };

    expect(densifyExternals([a, b], new Map())).toHaveLength(1);
  });

  it('keeps the first dev hint when merging, without letting it split the group', () => {
    const result = densifyExternals(
      [
        flat('rxjs', 'rxjs.js', { dev: { entryPoint: 'rxjs/index.js' } }),
        flat('rxjs/operators', 'rxjs-operators.js', {
          dev: { entryPoint: 'rxjs/operators/index.js' },
        }),
      ],
      new Map()
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.dev).toEqual({ entryPoint: 'rxjs/index.js' });
  });

  // Discussion #176: mapping names can mark a domain rather than one package.
  it('groups a mapping under its declared package', () => {
    const result = densifyExternals(
      [
        flat('@shared/components/table', 'table.js'),
        flat('@shared/components/collapse', 'collapse.js'),
        flat('@shared/components/table/row', 'table-row.js'),
      ],
      new Map([
        ['@shared/components/table', '@shared/components/table'],
        ['@shared/components/collapse', '@shared/components/collapse'],
        ['@shared/components/table/row', '@shared/components/table'],
      ])
    ) as DenseSharedInfo[];

    expect(result.map(d => [d.packageName, Object.keys(d.entries)])).toEqual([
      ['@shared/components/table', ['@shared/components/table', '@shared/components/table/row']],
      ['@shared/components/collapse', ['@shared/components/collapse']],
    ]);
  });

  it('groups a name the mapping packages do not list under its npm package', () => {
    const result = densifyExternals(
      [flat('@angular/common', 'common.js'), flat('@angular/common/http', 'http.js')],
      new Map([['@shared/table', '@shared/table']])
    ) as DenseSharedInfo[];

    expect(result.map(d => d.packageName)).toEqual(['@angular/common']);
  });

  // Without a main entry, the first listed entry point configures the package.
  it('takes a package version from its first entry point', () => {
    const shared = [
      flat('@org/ui/table', 'table.js'),
      flat('@org/ui/button', 'button.js', { version: '2.0.0' }),
    ];

    expect(densify(shared).map(d => [d.packageName, d.version, Object.keys(d.entries)])).toEqual([
      ['@org/ui', '1.2.3', ['@org/ui/table', '@org/ui/button']],
    ]);
  });

  it('emits only dense objects, never an outFileName', () => {
    const result = densifyExternals(
      [flat('tslib', 'tslib.js'), flat('rxjs', 'rxjs.js')],
      new Map()
    );

    for (const entry of result) {
      expect(entry).toHaveProperty('entries');
      expect(entry).not.toHaveProperty('outFileName');
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
    const result = densifyExternals([dense], new Map());

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(dense);
  });

  it('preserves first-seen order across dense groups', () => {
    const result = densifyExternals(
      [
        flat('tslib', 'tslib.js'),
        flat('rxjs', 'rxjs.js'),
        flat('@angular/common', 'common.js'),
        flat('@angular/common/http', 'common-http.js'),
      ],
      new Map()
    );

    expect(result.map(r => r.packageName)).toEqual(['tslib', 'rxjs', '@angular/common']);
  });
});

describe('toDenseSharedInfoFormat', () => {
  it('converts each flat entry to its own dense object keyed by its packageName', () => {
    const result = toDenseSharedInfoFormat([flat('tslib', 'tslib.js'), flat('rxjs', 'rxjs.js')]);

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
