import { describe, expect, it } from 'vitest';
import { planSharedBundles, splitShared } from './shared-bundle-plan.js';
import type { NormalizedFederationConfig } from '../../domain/config/federation-config.contract.js';
import type { NormalizedExternalConfig } from '../../domain/config/external-config.contract.js';

function ext(overrides: Partial<NormalizedExternalConfig> = {}): NormalizedExternalConfig {
  return {
    singleton: true,
    strictVersion: true,
    requiredVersion: '^1.0.0',
    platform: 'browser',
    build: 'default',
    chunks: false,
    ...overrides,
  } as NormalizedExternalConfig;
}

function config(shared: Record<string, NormalizedExternalConfig>): NormalizedFederationConfig {
  return { chunks: false, shared } as NormalizedFederationConfig;
}

describe('planSharedBundles', () => {
  it('groups default packages into one browser-shared and one node-shared bundle', () => {
    const plans = planSharedBundles(
      config({
        a: ext({ platform: 'browser' }),
        b: ext({ platform: 'browser' }),
        c: ext({ platform: 'node' }),
      }),
      ['a', 'b', 'c']
    );

    const browser = plans.find(p => p.bundleName === 'browser-shared');
    const node = plans.find(p => p.bundleName === 'node-shared');
    expect(browser?.keys).toEqual(['a', 'b']);
    expect(node?.keys).toEqual(['c']);
    expect(plans.every(p => p.kind === 'shared')).toBe(true);
  });

  it('gives each separate package its own bundle and trims its own externals', () => {
    const plans = planSharedBundles(
      config({
        '@scope/lib': ext({ platform: 'browser', build: 'separate' }),
      }),
      ['@scope/lib', 'other']
    );

    expect(plans).toHaveLength(1);
    expect(plans[0]!.bundleName).toBe('browser-scope_lib');
    expect(plans[0]!.kind).toBe('separate');
    expect(plans[0]!.externals).toEqual(['other']);
  });

  it('splitShared routes by platform and build type', () => {
    const { sharedBrowser, sharedServer, separateBrowser, separateServer } = splitShared({
      a: ext({ platform: 'browser', build: 'default' }),
      b: ext({ platform: 'node', build: 'default' }),
      c: ext({ platform: 'browser', build: 'separate' }),
      d: ext({ platform: 'node', build: 'separate' }),
    });
    expect(Object.keys(sharedBrowser)).toEqual(['a']);
    expect(Object.keys(sharedServer)).toEqual(['b']);
    expect(Object.keys(separateBrowser)).toEqual(['c']);
    expect(Object.keys(separateServer)).toEqual(['d']);
  });
});
