import { describe, expect, it } from 'vitest';
import { planMappingBundles } from './mapping-bundle-plan.js';
import { mappingPackageByImport } from '../../config/mapping-utils.js';
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

  // A chunk shared by two packages would load twice once a runtime serves them from different
  // remotes, so every plan that may split holds one declared package at most.
  describe('declared packages', () => {
    const declared = (
      sharedMappings: PathToImport,
      prefixes: string[],
      sharedMappingsConfig: Record<string, NormalizedMappingConfig> = {},
      chunks = true
    ): NormalizedFederationConfig => ({
      ...config(sharedMappings, sharedMappingsConfig, chunks),
      sharedMappingPackages: Object.fromEntries(prefixes.map(p => [p, mappingCfg()])),
    });

    // The guarantee itself, checked on every case below: a plan that may split holds one package.
    function expectSafePlans(cfg: NormalizedFederationConfig) {
      const packages = mappingPackageByImport(cfg);
      for (const plan of planMappingBundles(cfg).filter(p => p.chunks)) {
        expect(new Set(Object.values(plan.entries).map(i => packages.get(i))).size).toBe(1);
      }
    }

    it('bundles single-entry packages together without splitting', () => {
      const cfg = declared(
        {
          './libs/table': '@shared/components/table',
          './libs/collapse': '@shared/components/collapse',
          './libs/utils': '@shared/utils',
        },
        ['@shared/components/table', '@shared/components/collapse', '@shared/utils']
      );

      expect(planMappingBundles(cfg)).toEqual([
        {
          bundleName: 'mapping-single-entry',
          chunks: false,
          entries: {
            './libs/table': '@shared/components/table',
            './libs/collapse': '@shared/components/collapse',
            './libs/utils': '@shared/utils',
          },
        },
      ]);
      expectSafePlans(cfg);
    });

    // #213: Nx gives every entry point an exact key; the declaration joins them.
    it('gives a multi-entry package a bundle of its own that keeps splitting', () => {
      const cfg = declared(
        {
          './libs/lib': '@org/lib',
          './libs/lib/testing': '@org/lib/testing',
          './libs/utils': '@shared/utils',
        },
        ['@org/lib', '@shared/utils']
      );

      expect(planMappingBundles(cfg)).toEqual([
        {
          bundleName: 'mapping-single-entry',
          chunks: false,
          entries: { './libs/utils': '@shared/utils' },
        },
        {
          bundleName: 'mapping-pkg-org_lib',
          chunks: true,
          entries: { './libs/lib': '@org/lib', './libs/lib/testing': '@org/lib/testing' },
        },
      ]);
      expectSafePlans(cfg);
    });

    // The package lookup comes first, so a build that reached the mapping some other way is moot.
    it('leaves mappings outside every package as they were', () => {
      const cfg = declared(
        {
          './libs/a': '@org/a',
          './libs/ui/button': '@org/ui/button',
          './libs/library': '@org/library',
          './libs/forms': '@shared/forms',
          './libs/forms/input': '@shared/forms/input',
        },
        ['@shared/forms'],
        { '@org/ui/*': mappingCfg({ build: 'package' }), '*': mappingCfg({ build: 'separate' }) }
      );

      expect(
        planMappingBundles(cfg).map(p => [p.bundleName, p.chunks, Object.values(p.entries)])
      ).toEqual([
        ['mapping-org_a', true, ['@org/a']],
        ['mapping-org_ui', true, ['@org/ui/button']],
        ['mapping-org_library', true, ['@org/library']],
        ['mapping-pkg-shared_forms', true, ['@shared/forms', '@shared/forms/input']],
      ]);
      expectSafePlans(cfg);
    });

    // The count is taken from the mappings that survived pruning.
    it('treats a package left with one entry as single-entry', () => {
      const cfg = declared({ './libs/forms': '@shared/forms' }, ['@shared/forms']);

      expect(planMappingBundles(cfg).map(p => [p.bundleName, p.chunks])).toEqual([
        ['mapping-single-entry', false],
      ]);
    });

    it('never turns splitting on for a package when the config turns it off', () => {
      const cfg = declared(
        { './libs/forms': '@shared/forms', './libs/forms/input': '@shared/forms/input' },
        ['@shared/forms'],
        {},
        false
      );

      expect(planMappingBundles(cfg).map(p => p.chunks)).toEqual([false]);
    });

    it('rejects two packages that would share a bundle name', () => {
      const cfg = declared(
        {
          './a/x': '@org/ui-table/x',
          './a/y': '@org/ui-table/y',
          './b/x': '@org/ui_table/x',
          './b/y': '@org/ui_table/y',
        },
        ['@org/ui-table', '@org/ui_table']
      );
      expect(() => planMappingBundles(cfg)).toThrow(
        /declared packages '@org\/ui-table' and '@org\/ui_table' would both be bundled as 'mapping-pkg-org_ui_table'/
      );
    });
  });

  it('plans nothing when there are no mappings', () => {
    expect(planMappingBundles(config({}))).toEqual([]);
  });
});
