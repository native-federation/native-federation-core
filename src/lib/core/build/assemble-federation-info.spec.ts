import { afterEach, describe, expect, it, vi } from 'vitest';
import { assembleFederationInfo } from './assemble-federation-info.js';
import { createFederationCache } from '../cache/federation-cache.js';
import { logger } from '../../utils/logger.js';
import type { NormalizedFederationConfig } from '../../domain/config/federation-config.contract.js';
import type { NormalizedFederationOptions } from '../../domain/core/federation-options.contract.js';
import type { SharedInfo } from '../../domain/core/federation-info.contract.js';

function flat(packageName: string, overrides: Partial<SharedInfo> = {}): SharedInfo {
  return {
    singleton: true,
    strictVersion: true,
    requiredVersion: '^7.0.0',
    version: '7.8.1',
    packageName,
    outFileName: packageName.replace(/\//g, '_') + '.js',
    ...overrides,
  };
}

// Only the fields assembleFederationInfo reads.
const config = {
  name: 'mfe1',
  sharedMappings: {},
  features: {},
} as unknown as NormalizedFederationConfig;

function fedOptions(externals: SharedInfo[]): NormalizedFederationOptions {
  const federationCache = createFederationCache('/cache');
  federationCache.externals.push(...externals);
  return { federationCache, dev: false } as unknown as NormalizedFederationOptions;
}

describe('assembleFederationInfo — one config per package', () => {
  afterEach(() => vi.restoreAllMocks());

  // The config is aligned when it is read; what is left is the version each entry point read from
  // its own package.json, which no config sets, so nothing is reported.
  it("publishes one record at the main entry's version for entry points that read different ones", () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const options = fedOptions([
      flat('rxjs/operators', { requiredVersion: '^6.0.0', version: '6.6.7' }),
      flat('rxjs'),
    ]);

    const info = assembleFederationInfo(config, options, { mappings: [], exposes: [] });

    expect(info.shared).toEqual([
      {
        singleton: true,
        strictVersion: true,
        requiredVersion: '^7.0.0',
        version: '7.8.1',
        packageName: 'rxjs',
        entries: { 'rxjs/operators': 'rxjs_operators.js', rxjs: 'rxjs.js' },
      },
    ]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('stays silent when the entry points agree', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const options = fedOptions([flat('rxjs'), flat('rxjs/operators')]);

    const info = assembleFederationInfo(config, options, { mappings: [], exposes: [] });

    expect(info.shared).toHaveLength(1);
    expect(warn).not.toHaveBeenCalled();
  });
});
