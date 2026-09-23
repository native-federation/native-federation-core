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
  sharedMappingsConfig: Record<string, NormalizedMappingConfig> = {}
): NormalizedFederationConfig {
  return {
    sharedMappings,
    sharedMappingsConfig,
    features: { mappingVersion: false },
  } as NormalizedFederationConfig;
}

describe('planMappingBundles', () => {
  it('puts every unannotated mapping in one bundle, in declaration order', () => {
    const plans = planMappingBundles(
      config({ './libs/a': '@org/a', './libs/b': '@org/b' })
    );

    expect(plans).toEqual([
      { bundleName: 'mapping-bundle', entries: { './libs/a': '@org/a', './libs/b': '@org/b' } },
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
      { bundleName: 'mapping-org_a', entries: { './libs/a': '@org/a' } },
      { bundleName: 'mapping-bundle', entries: { './libs/b': '@org/b' } },
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

  it('plans nothing when there are no mappings', () => {
    expect(planMappingBundles(config({}))).toEqual([]);
  });
});
