import { afterEach, describe, expect, it, vi } from 'vitest';
import { planSharedBundles, splitShared } from './shared-bundle-plan.js';
import type { NormalizedFederationConfig } from '../../domain/config/federation-config.contract.js';
import type { NormalizedExternalConfig } from '../../domain/config/external-config.contract.js';
import { logger } from '../../utils/logger.js';

function ext(overrides: Partial<NormalizedExternalConfig> = {}): NormalizedExternalConfig {
  return {
    singleton: true,
    strictVersion: true,
    requiredVersion: '^1.0.0',
    platform: 'browser',
    build: 'default',
    ...overrides,
  } as NormalizedExternalConfig;
}

function config(
  shared: Record<string, NormalizedExternalConfig>,
  chunks = false
): NormalizedFederationConfig {
  return { chunks, shared } as NormalizedFederationConfig;
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

  it('keeps a package that only shares a name prefix external', () => {
    const plans = planSharedBundles(
      config({ react: ext({ platform: 'browser', build: 'package' }) }),
      ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client']
    );

    expect(plans[0]!.externals).toEqual(['react-dom', 'react-dom/client']);
  });

  // A wildcard external is not this package's own entry point, so it stays, like 'react-dom'.
  it('keeps a wildcard external that only starts with the package name', () => {
    const plans = planSharedBundles(
      config({ react: ext({ platform: 'browser', build: 'package' }) }),
      ['react', 'react*']
    );

    expect(plans[0]!.externals).toEqual(['react*']);
  });

  // core#249: unshared deps that pool members both import are split out once, not inlined per member.
  describe("build: 'pool'", () => {
    const pooled = (pool: string, overrides: Partial<NormalizedExternalConfig> = {}) =>
      ext({ build: 'pool', pool, ...overrides });

    it('builds the members of one pool in one bundle per platform', () => {
      const plans = planSharedBundles(
        config({
          libA: pooled('p1'),
          'libA/sub': pooled('p1'),
          libB: pooled('p1'),
          libS: pooled('p1', { platform: 'node' }),
        }),
        []
      );

      expect(plans.map(p => [p.bundleName, p.keys, p.kind])).toEqual([
        ['browser-pool-p1', ['libA', 'libA/sub', 'libB'], 'separate'],
        ['node-pool-p1', ['libS'], 'separate'],
      ]);
    });

    it('gives each pool a bundle of its own', () => {
      const plans = planSharedBundles(config({ libA: pooled('p1'), libB: pooled('p2') }), []);

      expect(plans.map(p => p.bundleName)).toEqual(['browser-pool-p1', 'browser-pool-p2']);
    });

    // Like the combined bundle: members stay bare to each other and to their own subpaths, so a
    // member imported from elsewhere is still served through the import map.
    it('keeps the full externals list', () => {
      const externals = ['libA', 'libA/sub', 'libB', 'other'];
      const plans = planSharedBundles(
        config({ libA: pooled('p1'), 'libA/sub': pooled('p1'), libB: pooled('p1') }),
        externals
      );

      expect(plans[0]!.externals).toEqual(externals);
    });

    it('does not collide with a package whose name starts with pool-', () => {
      const plans = planSharedBundles(
        config({ 'pool-p1': ext({ build: 'package' }), libA: pooled('p1') }),
        []
      );

      expect(plans.map(p => p.bundleName)).toEqual(['browser-pool_p1', 'browser-pool-p1']);
    });

    // The runtime pools per share scope, so one label in two scopes is two pools.
    it('gives each share scope of a pool a bundle of its own', () => {
      const plans = planSharedBundles(
        config({ libA: pooled('p1'), libB: pooled('p1', { shareScope: 'iso' }) }),
        []
      );

      expect(plans.map(p => p.bundleName)).toEqual(['browser-pool-p1', 'browser-pool-iso-p1']);
    });

    // `pool` alone is runtime metadata; only build: 'pool' moves a package.
    it('leaves a pooled package without build in the combined bundle', () => {
      const plans = planSharedBundles(config({ libA: ext({ pool: 'p1' }) }), []);

      expect(plans.map(p => p.bundleName)).toEqual(['browser-shared']);
    });

    it('lets a member that sets chunks decide it for the pool', () => {
      const plans = planSharedBundles(
        config({ libA: pooled('p1'), libB: pooled('p1', { chunks: false }) }, true),
        []
      );

      expect(plans[0]!.chunks).toBe(false);
    });
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

  // `chunks` is a setting of the bundle; an external that leaves it out has no vote (core#216).
  describe('chunks', () => {
    afterEach(() => vi.restoreAllMocks());

    const chunksOf = (cfg: NormalizedFederationConfig) =>
      planSharedBundles(cfg, []).map(p => [p.bundleName, p.chunks]);

    it('builds browser-shared and node-shared with the global chunks', () => {
      const cfg = config({ a: ext(), b: ext({ platform: 'node' }) }, true);

      expect(chunksOf(cfg)).toEqual([
        ['browser-shared', true],
        ['node-shared', true],
      ]);
    });

    it('gives a separate external its own chunks', () => {
      const cfg = config({ '@org/a': ext({ build: 'separate', chunks: false }) }, true);

      expect(chunksOf(cfg)).toEqual([['browser-org_a', false]]);
    });

    it('falls back to the global chunks when no external in the bundle sets it', () => {
      const cfg = config({ '@org/ui': ext({ build: 'package' }) }, true);

      expect(chunksOf(cfg)).toEqual([['browser-org_ui', true]]);
    });

    it("applies one entry's value to the entries of its package that leave it unset", () => {
      const cfg = config(
        {
          '@org/ui': ext({ build: 'package', chunks: false }),
          '@org/ui/button': ext({ build: 'package' }),
        },
        true
      );

      expect(chunksOf(cfg)).toEqual([['browser-org_ui', false]]);
    });

    // The disagreement is reported by normalizeShared, once per config load.
    it('keeps the first value when two entries of one package disagree, without a warning', () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
      const cfg = config({
        '@org/ui': ext({ build: 'package', chunks: true }),
        '@org/ui/button': ext({ build: 'package', chunks: false }),
      });

      expect(chunksOf(cfg)).toEqual([['browser-org_ui', true]]);
      expect(warn).not.toHaveBeenCalled();
    });
  });
});
