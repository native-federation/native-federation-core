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
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
      const cfg = config(
        {
          '@org/ui': ext({ build: 'package', chunks: false }),
          '@org/ui/button': ext({ build: 'package' }),
        },
        true
      );

      expect(chunksOf(cfg)).toEqual([['browser-org_ui', false]]);
      expect(warn).not.toHaveBeenCalled();
    });

    it('warns when two entries of one package disagree, and keeps the first value', () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
      const cfg = config({
        '@org/ui': ext({ build: 'package', chunks: true }),
        '@org/ui/button': ext({ build: 'package', chunks: false }),
      });

      expect(chunksOf(cfg)).toEqual([['browser-org_ui', true]]);
      expect(warn).toHaveBeenCalledWith(
        expect.stringMatching(
          /'@org\/ui' \(chunks: true\) and '@org\/ui\/button' \(chunks: false\) are built in one bundle, 'browser-org_ui'/
        )
      );
    });
  });
});
