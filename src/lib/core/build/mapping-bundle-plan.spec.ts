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

  // `chunks` is a setting of the bundle, so a mapping's value applies to everything built with it.
  describe('chunks', () => {
    const chunksOf = (cfg: NormalizedFederationConfig) =>
      planMappingBundles(cfg).map(p => [p.bundleName, p.chunks]);

    it('takes the global value when no mapping sets it', () => {
      expect(chunksOf(config({ './libs/a': '@org/a' }, {}, false))).toEqual([
        ['mapping-bundle', false],
      ]);
    });

    it("applies one mapping's value to the mappings that leave it unset", () => {
      const cfg = config(
        { './libs/a': '@org/a', './libs/b': '@org/b' },
        { '@org/b': mappingCfg({ chunks: false }) }
      );

      expect(chunksOf(cfg)).toEqual([['mapping-bundle', false]]);
    });

    it('accepts mappings that agree', () => {
      const cfg = config(
        { './libs/a': '@org/a', './libs/b': '@org/b' },
        { '@org/a': mappingCfg({ chunks: true }), '@org/b': mappingCfg({ chunks: true }) },
        false
      );

      expect(chunksOf(cfg)).toEqual([['mapping-bundle', true]]);
    });

    it('sets a bundle of its own apart from the global value', () => {
      const cfg = config(
        { './libs/a': '@org/a', './libs/b': '@org/b' },
        { '@org/a': mappingCfg({ build: 'separate', chunks: false }) }
      );

      expect(chunksOf(cfg)).toEqual([
        ['mapping-org_a', false],
        ['mapping-bundle', true],
      ]);
    });

    it('rejects two mappings in one bundle that disagree, naming both', () => {
      const cfg = config(
        { './libs/a': '@org/a', './libs/b': '@org/b' },
        { '@org/a': mappingCfg({ chunks: true }), '@org/b': mappingCfg({ chunks: false }) }
      );

      expect(() => planMappingBundles(cfg)).toThrow(
        /'@org\/a' \(chunks: true\) and '@org\/b' \(chunks: false\) are built in one bundle, 'mapping-bundle'/
      );
    });

    // Two patterns can reach one inferred package; first-match-wins only picks each import's config.
    it("rejects two 'package' patterns that disagree within one package", () => {
      const cfg = config(
        { './libs/ui/button': '@org/ui/button', './libs/ui/card': '@org/ui/card' },
        {
          '@org/ui/button': mappingCfg({ build: 'package', chunks: true }),
          '@org/ui/*': mappingCfg({ build: 'package', chunks: false }),
        }
      );

      expect(() => planMappingBundles(cfg)).toThrow(/'mapping-org_ui'/);
    });

    // Declared packages share the default bundle, so their values have to agree as well.
    it('rejects declared packages that disagree', () => {
      const cfg: NormalizedFederationConfig = {
        ...config({ './libs/a': '@org/a', './libs/b': '@org/b' }),
        sharedMappingPackages: {
          '@org/a': mappingCfg({ chunks: false }),
          '@org/b': mappingCfg({ chunks: true }),
        },
      };

      expect(() => planMappingBundles(cfg)).toThrow(/'@org\/a' \(chunks: false\) and '@org\/b'/);
    });
  });

  it('plans nothing when there are no mappings', () => {
    expect(planMappingBundles(config({}))).toEqual([]);
  });
});
