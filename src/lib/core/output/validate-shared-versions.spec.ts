import { afterEach, describe, expect, it, vi } from 'vitest';
import { findVersionConflicts, validateSharedVersions } from './validate-shared-versions.js';
import { densifyExternals } from './densify-externals.js';
import type {
  DenseSharedInfo,
  FederationInfo,
  SharedInfo,
} from '../../domain/core/federation-info.contract.js';
import type { NormalizedFederationConfig } from '../../domain/config/federation-config.contract.js';
import type { FederationCache } from '../../domain/core/federation-cache.contract.js';
import { logger } from '../../utils/logger.js';

function flat(
  packageName: string,
  version: string,
  overrides: Partial<SharedInfo> = {}
): SharedInfo {
  return {
    singleton: true,
    strictVersion: true,
    requiredVersion: '^20.0.0',
    version,
    packageName,
    outFileName: packageName.replace(/\W/g, '_') + '.js',
    ...overrides,
  };
}

describe('findVersionConflicts', () => {
  it('accepts a package whose root and sub-paths agree', () => {
    const shared = [
      flat('@angular/common', '20.3.4'),
      flat('@angular/common/http', '20.3.4'),
      flat('@angular/common/locales/nl', '20.3.4'),
    ];

    expect(findVersionConflicts(shared, new Map())).toEqual([]);
  });

  // core#233: the locale carried the range's floor next to the installed root.
  it('reports a sub-path at another version than its root', () => {
    const shared = [
      flat('@angular/common', '20.3.4'),
      flat('@angular/common/locales/nl', '20.0.0'),
    ];

    expect(findVersionConflicts(shared, new Map())).toEqual([
      { packageName: '@angular/common', versions: ['20.3.4', '20.0.0'] },
    ]);
  });

  it('counts a missing version as a version of its own', () => {
    const shared = [
      flat('@angular/common', '20.3.4'),
      { ...flat('@angular/common/locales/nl', ''), version: undefined } as unknown as SharedInfo,
    ];

    expect(findVersionConflicts(shared, new Map())[0]!.versions).toEqual(['20.3.4', '(none)']);
  });

  // Only singletons take part in the runtime's election; chunks are never singletons.
  it('ignores records that are not singletons', () => {
    const shared = [
      flat('lodash', '4.17.21'),
      flat('lodash/fp', '4.17.0', { singleton: false }),
      flat('@nf-internal/chunk-ABC', '0.0.0', { singleton: false }),
    ];

    expect(findVersionConflicts(shared, new Map())).toEqual([]);
  });

  it('keeps share scopes apart', () => {
    const shared = [
      flat('rxjs', '7.8.0'),
      flat('rxjs/operators', '7.5.0', { shareScope: 'legacy' }),
    ];

    expect(findVersionConflicts(shared, new Map())).toEqual([]);
  });

  it('reads dense records under their package name', () => {
    // Version is part of densify's grouping signature, so a mismatch yields two dense records.
    const shared = densifyExternals(
      [flat('@angular/common', '20.3.4'), flat('@angular/common/locales/nl', '20.0.0')],
      new Map()
    );

    expect(shared).toHaveLength(2);
    expect(findVersionConflicts(shared, new Map())).toEqual([
      { packageName: '@angular/common', versions: ['20.3.4', '20.0.0'] },
    ]);
  });

  it('groups mappings under their declared package', () => {
    const shared = [flat('@org/ui-core', '1.0.0'), flat('@org/ui-button', '1.1.0')];
    const declared = new Map([
      ['@org/ui-core', '@org/ui'],
      ['@org/ui-button', '@org/ui'],
    ]);

    expect(findVersionConflicts(shared, new Map())).toEqual([]);
    expect(findVersionConflicts(shared, declared)).toEqual([
      { packageName: '@org/ui', versions: ['1.0.0', '1.1.0'] },
    ]);
  });
});

describe('validateSharedVersions', () => {
  afterEach(() => vi.restoreAllMocks());

  const config = (strictImports = false) =>
    ({
      sharedMappings: {},
      features: { strictImports },
    }) as unknown as NormalizedFederationConfig;

  const info = (shared: Array<SharedInfo | DenseSharedInfo>) =>
    ({ name: 'app', shared, exposes: [] }) as unknown as FederationInfo;

  const conflicting = info([flat('foo', '2.3.4'), flat('foo/sub', '2.0.0')]);

  it('warns once, and again only when the conflicts change or on a full report', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const cache = {} as FederationCache;

    validateSharedVersions(config(), conflicting, cache, { fullReport: true });
    validateSharedVersions(config(), conflicting, cache, { fullReport: false });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("'foo' is published at 2.3.4, 2.0.0")
    );

    validateSharedVersions(config(), conflicting, cache, { fullReport: true });
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('throws under strictImports', () => {
    vi.spyOn(logger, 'error').mockImplementation(() => undefined);

    expect(() =>
      validateSharedVersions(config(true), conflicting, {} as FederationCache, {
        fullReport: false,
      })
    ).toThrow(/1 shared package\(s\) published at more than one version/);
  });

  it('stays silent when every package has one version', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    validateSharedVersions(config(true), info([flat('foo', '2.3.4')]), {} as FederationCache, {
      fullReport: true,
    });

    expect(warn).not.toHaveBeenCalled();
  });
});
