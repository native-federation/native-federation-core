import { describe, expect, it } from 'vitest';
import { assembleFederationInfo } from './assemble-federation-info.js';
import { normalizeMappingConfig } from '../../config/mapping-utils.js';
import type {
  NormalizedFederationConfig,
  SharedMappingConfigs,
} from '../../domain/config/federation-config.contract.js';
import type {
  ArtifactInfo,
  DenseSharedInfo,
  SharedInfo,
} from '../../domain/core/federation-info.contract.js';
import type { NormalizedFederationOptions } from '../../domain/core/federation-options.contract.js';

function mapping(packageName: string): SharedInfo {
  return {
    packageName,
    outFileName: packageName.replace(/\W/g, '_') + '.js',
    singleton: true,
    strictVersion: true,
    requiredVersion: '',
    version: '',
  };
}

// The declared packages are read from the config, so every mapped import needs a sharedMappings
// entry; the path is irrelevant here.
function config(
  imports: string[],
  mappingConfigs: SharedMappingConfigs,
  denseExternals = true
): NormalizedFederationConfig {
  return {
    name: 'remote',
    sharedMappings: Object.fromEntries(imports.map(i => [`./libs/${i}`, i])),
    sharedMappingsConfig: Object.fromEntries(
      Object.entries(mappingConfigs).map(([k, v]) => [k, normalizeMappingConfig(v, true)])
    ),
    features: { denseExternals, mappingVersion: true },
  } as unknown as NormalizedFederationConfig;
}

const fedOptions = {
  federationCache: { externals: [mapping('rxjs'), mapping('rxjs/operators')] },
} as unknown as NormalizedFederationOptions;

function assemble(cfg: NormalizedFederationConfig) {
  const mappings = Object.values(cfg.sharedMappings).map(mapping);
  return assembleFederationInfo(cfg, fedOptions, {
    mappings,
    exposes: [],
  } as unknown as ArtifactInfo);
}

function packages(cfg: NormalizedFederationConfig) {
  return (assemble(cfg).shared as DenseSharedInfo[]).map(s => [
    s.packageName,
    Object.keys(s.entries),
  ]);
}

// core#198 / discussion #176: mapping names can mark a domain rather than one package.
describe('assembleFederationInfo — declared mapping packages', () => {
  it('publishes each mapping of a package: true pattern as its own package', () => {
    const cfg = config(['@shared/components/table', '@shared/components/collapse'], {
      '@shared/components/*': { package: true },
    });

    expect(packages(cfg)).toEqual([
      ['rxjs', ['rxjs', 'rxjs/operators']],
      ['@shared/components/table', ['@shared/components/table']],
      ['@shared/components/collapse', ['@shared/components/collapse']],
    ]);
  });

  // Deeper than the name rule, which would put all three under '@shared/components'.
  it('publishes the mappings of a named package together, next to undeclared ones', () => {
    const cfg = config(
      ['@shared/components/table', '@shared/components/table/row', '@shared/components/x'],
      {
        '@shared/components/table': { package: '@shared/components/table' },
        '@shared/components/table/*': { package: '@shared/components/table' },
      }
    );

    expect(packages(cfg)).toEqual([
      ['rxjs', ['rxjs', 'rxjs/operators']],
      ['@shared/components/table', ['@shared/components/table', '@shared/components/table/row']],
      ['@shared/components', ['@shared/components/x']],
    ]);
  });

  it('leaves the output flat without denseExternals', () => {
    const cfg = config(['@shared/table'], { '@shared/table': { package: true } }, false);

    expect(assemble(cfg).shared).toEqual([
      mapping('rxjs'),
      mapping('rxjs/operators'),
      mapping('@shared/table'),
    ]);
  });
});
