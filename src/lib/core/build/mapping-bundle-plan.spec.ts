import { describe, expect, it } from 'vitest';
import { planMappingBundles } from './mapping-bundle-plan.js';
import { declaredMappingPackages } from '../../config/mapping-utils.js';
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

  // core#198: a chunk shared by two declared packages would load twice once a runtime serves them
  // from different builds, so every plan that may split holds one declared package at most.
  describe('declared packages', () => {
    const declared = (packageName: true | string) => mappingCfg({ package: packageName });

    const formsPackage = {
      '@shared/forms': declared('@shared/forms'),
      '@shared/forms/*': declared('@shared/forms'),
    };

    // The guarantee itself: a plan that may split holds one declared package, or only undeclared
    // mappings.
    function expectNoSplitAcrossPackages(cfg: NormalizedFederationConfig) {
      const packages = declaredMappingPackages(cfg);
      for (const plan of planMappingBundles(cfg).filter(p => p.chunks)) {
        expect(new Set(Object.values(plan.entries).map(i => packages.get(i))).size).toBe(1);
      }
    }

    it('bundles single-entry packages together without splitting', () => {
      const cfg = config(
        {
          './libs/table': '@shared/components/table',
          './libs/collapse': '@shared/components/collapse',
        },
        { '@shared/components/*': declared(true) }
      );

      expect(planMappingBundles(cfg)).toEqual([
        {
          bundleName: 'mapping-single-entry',
          chunks: false,
          entries: {
            './libs/table': '@shared/components/table',
            './libs/collapse': '@shared/components/collapse',
          },
        },
      ]);
      expectNoSplitAcrossPackages(cfg);
    });

    it('gives a multi-entry package a bundle of its own that keeps splitting', () => {
      const cfg = config(
        { './libs/forms': '@shared/forms', './libs/forms/input': '@shared/forms/input' },
        formsPackage
      );

      expect(planMappingBundles(cfg)).toEqual([
        {
          bundleName: 'mapping-pkg-shared_forms',
          chunks: true,
          entries: { './libs/forms': '@shared/forms', './libs/forms/input': '@shared/forms/input' },
        },
      ]);
    });

    it('leaves undeclared mappings as they were next to declared ones', () => {
      const cfg = config(
        {
          './libs/utils': '@shared/utils',
          './libs/table': '@shared/table',
          './libs/forms': '@shared/forms',
          './libs/forms/input': '@shared/forms/input',
          './libs/ui/button': '@shared/ui/button',
        },
        {
          '@shared/table': declared(true),
          ...formsPackage,
          '@shared/ui/*': mappingCfg({ build: 'package' }),
        }
      );

      expect(
        planMappingBundles(cfg).map(p => [p.bundleName, p.chunks, Object.values(p.entries)])
      ).toEqual([
        ['mapping-bundle', true, ['@shared/utils']],
        ['mapping-shared_ui', true, ['@shared/ui/button']],
        ['mapping-single-entry', false, ['@shared/table']],
        ['mapping-pkg-shared_forms', true, ['@shared/forms', '@shared/forms/input']],
      ]);
      expectNoSplitAcrossPackages(cfg);
    });

    // Without the prefix both would be bundled as mapping-shared_forms, which would put the
    // undeclared mapping in the declared package's run.
    it('keeps an undeclared build: package mapping out of a declared package of the same name', () => {
      const cfg = config(
        {
          './libs/forms': '@shared/forms',
          './libs/forms/input': '@shared/forms/input',
          './libs/forms/legacy': '@shared/forms/legacy',
        },
        { '@shared/forms/legacy': mappingCfg({ build: 'package' }), ...formsPackage }
      );

      expect(planMappingBundles(cfg).map(p => p.bundleName)).toEqual([
        'mapping-shared_forms',
        'mapping-pkg-shared_forms',
      ]);
      expectNoSplitAcrossPackages(cfg);
    });

    // The count is taken from the mappings that survived pruning.
    it('treats a package left with one entry as single-entry', () => {
      const cfg = config({ './libs/forms': '@shared/forms' }, formsPackage);

      expect(planMappingBundles(cfg)).toEqual([
        {
          bundleName: 'mapping-single-entry',
          chunks: false,
          entries: { './libs/forms': '@shared/forms' },
        },
      ]);
    });

    it('never turns splitting on for a package when the config turns it off', () => {
      const cfg = config(
        { './libs/forms': '@shared/forms', './libs/forms/input': '@shared/forms/input' },
        formsPackage,
        false
      );

      expect(planMappingBundles(cfg).map(p => p.chunks)).toEqual([false]);
    });

    it('rejects two packages that would share a bundle name', () => {
      const cfg = config(
        {
          './a/x': '@org/ui-table/x',
          './a/y': '@org/ui-table/y',
          './b/x': '@org/ui_table/x',
          './b/y': '@org/ui_table/y',
        },
        {
          '@org/ui-table/*': declared('@org/ui-table'),
          '@org/ui_table/*': declared('@org/ui_table'),
        }
      );

      expect(() => planMappingBundles(cfg)).toThrow(
        "Declared packages '@org/ui-table' and '@org/ui_table' would both be bundled as 'mapping-pkg-org_ui_table'"
      );
    });

    // First match wins, so a broader pattern listed first keeps its mappings undeclared.
    it('follows the first matching pattern', () => {
      const cfg = config(
        { './libs/table': '@shared/table' },
        { '@shared/*': mappingCfg(), '@shared/table': declared(true) }
      );

      expect(planMappingBundles(cfg).map(p => p.bundleName)).toEqual(['mapping-bundle']);
    });
  });

  it('plans nothing when there are no mappings', () => {
    expect(planMappingBundles(config({}))).toEqual([]);
  });
});
