import { describe, expect, it } from 'vitest';
import { planMappingBundles } from './mapping-bundle-plan.js';
import type {
  NormalizedFederationConfig,
  NormalizedMappingConfig,
} from '../../domain/config/federation-config.contract.js';
import type { PathToImport } from '../../domain/utils/mapped-path.contract.js';

function mappingCfg(overrides: Partial<NormalizedMappingConfig> = {}): NormalizedMappingConfig {
  return { singleton: true, strictVersion: false, ...overrides };
}

function config(
  sharedMappings: PathToImport,
  sharedMappingsConfig: Record<string, NormalizedMappingConfig> = {},
  chunks = true
): NormalizedFederationConfig {
  return {
    sharedMappings,
    sharedMappingsConfig,
    chunks,
    features: { mappingVersion: false },
  } as NormalizedFederationConfig;
}

describe('planMappingBundles', () => {
  it('puts every unannotated mapping in one bundle, in declaration order', () => {
    const plans = planMappingBundles(config({ './libs/a': '@org/a', './libs/b': '@org/b' }));

    expect(plans).toEqual([
      {
        bundleName: 'mapping-bundle',
        chunks: true,
        entries: { './libs/a': '@org/a', './libs/b': '@org/b' },
      },
    ]);
  });

  it("gives a 'separate' mapping a bundle of its own and leaves the rest together", () => {
    const plans = planMappingBundles(
      config(
        { './libs/a': '@org/a', './libs/b': '@org/b' },
        { '@org/a': mappingCfg({ build: 'separate' }) }
      )
    );

    expect(plans).toEqual([
      { bundleName: 'mapping-org_a', chunks: true, entries: { './libs/a': '@org/a' } },
      { bundleName: 'mapping-bundle', chunks: true, entries: { './libs/b': '@org/b' } },
    ]);
  });

  // A wildcard mapping is expanded before this runs, so 'package' is what keeps the entry points
  // of one lib in one bundle while 'separate' splits them apart.
  it("groups the entry points of one lib under 'package' and splits them under 'separate'", () => {
    const expanded = { './libs/ui/button': '@org/ui/button', './libs/ui/card': '@org/ui/card' };

    expect(
      planMappingBundles(config(expanded, { '@org/ui/*': mappingCfg({ build: 'package' }) })).map(
        p => p.bundleName
      )
    ).toEqual(['mapping-org_ui']);

    expect(
      planMappingBundles(config(expanded, { '@org/ui/*': mappingCfg({ build: 'separate' }) })).map(
        p => p.bundleName
      )
    ).toEqual(['mapping-org_ui_button', 'mapping-org_ui_card']);
  });

  // A declaration says which entry points form one package; it selects no bundle, so declared
  // packages are bundled like any other mapping without a build.
  describe('declared packages', () => {
    const declared = (
      sharedMappings: PathToImport,
      prefixes: string[],
      sharedMappingsConfig: Record<string, NormalizedMappingConfig> = {}
    ): NormalizedFederationConfig => ({
      ...config(sharedMappings, sharedMappingsConfig),
      sharedMappingPackages: Object.fromEntries(prefixes.map(p => [p, mappingCfg()])),
    });

    // #213: Nx gives every entry point an exact key; the declaration joins them.
    it('bundles single- and multi-entry packages together in the default bundle', () => {
      const cfg = declared(
        {
          './libs/lib': '@org/lib',
          './libs/lib/testing': '@org/lib/testing',
          './libs/utils': '@shared/utils',
          './libs/other': '@org/other',
        },
        ['@org/lib', '@shared/utils']
      );

      expect(planMappingBundles(cfg)).toEqual([
        {
          bundleName: 'mapping-bundle',
          chunks: true,
          entries: {
            './libs/lib': '@org/lib',
            './libs/lib/testing': '@org/lib/testing',
            './libs/utils': '@shared/utils',
            './libs/other': '@org/other',
          },
        },
      ]);
    });

    // The package's config outranks every pattern, so a build that would reach the mapping
    // through a pattern does not apply to it.
    it('ignores pattern builds for declared mappings and keeps them for the rest', () => {
      const cfg = declared(
        {
          './libs/a': '@org/a',
          './libs/ui/button': '@org/ui/button',
          './libs/forms': '@shared/forms',
          './libs/forms/input': '@shared/forms/input',
        },
        ['@shared/forms'],
        { '@org/ui/*': mappingCfg({ build: 'package' }), '*': mappingCfg({ build: 'separate' }) }
      );

      expect(planMappingBundles(cfg).map(p => [p.bundleName, Object.values(p.entries)])).toEqual([
        ['mapping-org_a', ['@org/a']],
        ['mapping-org_ui', ['@org/ui/button']],
        ['mapping-bundle', ['@shared/forms', '@shared/forms/input']],
      ]);
    });
  });

  it('plans nothing when there are no mappings', () => {
    expect(planMappingBundles(config({}))).toEqual([]);
  });
});
