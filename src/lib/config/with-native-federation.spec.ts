import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// with-native-federation reaches the filesystem through share-utils and
// mapped-paths; stub those so the normalization logic can be tested in isolation.
const shareAll = vi.fn();
const findRootTsConfigJson = vi.fn();
const getRawMappedPaths = vi.fn();

vi.mock('./share-utils.js', () => ({
  shareAll: (...args: unknown[]) => shareAll(...args),
  findRootTsConfigJson: (...args: unknown[]) => findRootTsConfigJson(...args),
}));

vi.mock('./mapped-paths.js', () => ({
  getRawMappedPaths: (...args: unknown[]) => getRawMappedPaths(...args),
}));

import { withNativeFederation } from './with-native-federation.js';
import { logger } from '../utils/logger.js';
import type { FederationConfig } from '../domain/config/federation-config.contract.js';

describe('withNativeFederation', () => {
  beforeEach(() => {
    shareAll.mockReturnValue({});
    findRootTsConfigJson.mockReturnValue('/ws/tsconfig.json');
    getRawMappedPaths.mockReturnValue({});
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('applies defaults for an empty config', () => {
    const result = withNativeFederation({});

    expect(result).toMatchObject({
      $type: 'classic',
      name: '',
      exposes: {},
      shared: {},
      sharedMappings: {},
      chunks: true,
      externals: [],
      features: {
        mappingVersion: true,
        ignoreUnusedDeps: true,
        denseChunking: false,
        integrityHashes: false,
      },
    });
  });

  it('falls back to shareAll when no shared config is provided', () => {
    shareAll.mockReturnValue({ react: { singleton: true } });

    const result = withNativeFederation({});

    expect(shareAll).toHaveBeenCalled();
    expect(result.shared['react']).toMatchObject({ singleton: true });
  });

  it('does not call shareAll when shared is explicitly configured', () => {
    withNativeFederation({ shared: { react: { singleton: true } } });
    expect(shareAll).not.toHaveBeenCalled();
  });

  it('normalizes string exposes into { file } entries and passes objects through', () => {
    const result = withNativeFederation({
      exposes: {
        './Cmp': './src/cmp.ts',
        './Other': { file: './src/other.ts', element: 'x-other' },
      },
    });

    expect(result.exposes).toEqual({
      './Cmp': { file: './src/cmp.ts' },
      './Other': { file: './src/other.ts', element: 'x-other' },
    });
  });

  it('normalizes shared externals with sensible defaults', () => {
    const result = withNativeFederation({ shared: { react: {} } });

    expect(result.shared['react']).toEqual({
      requiredVersion: 'auto',
      singleton: false,
      strictVersion: false,
      version: undefined,
      chunks: true,
      includeSecondaries: undefined,
      packageInfo: undefined,
      platform: 'browser',
      build: 'default',
    });
  });

  it('inherits the top-level platform when a shared entry omits one', () => {
    const result = withNativeFederation({
      platform: 'node',
      shared: { react: {} },
    });

    expect(result.shared['react'].platform).toBe('node');
  });

  it('normalizes backslashes in shared keys to forward slashes', () => {
    const config = { shared: { 'scope\\pkg': {} } } as unknown as FederationConfig;
    const result = withNativeFederation(config);

    expect(Object.keys(result.shared)).toEqual(['scope/pkg']);
  });

  it('removes shared externals that are in the skip list', () => {
    const result = withNativeFederation({
      shared: { react: {}, skipped: {} },
      skip: ['skipped'],
    });

    expect(Object.keys(result.shared)).toEqual(['react']);
  });

  it('warns and overrides chunks when an external sets chunks without a build type', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    const result = withNativeFederation({
      chunks: false,
      shared: { react: { chunks: true } },
    });

    expect(warn).toHaveBeenCalled();
    expect(result.shared['react'].chunks).toBe(false);
  });

  it('does not warn when an explicit build type accompanies chunk settings', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    const result = withNativeFederation({
      chunks: false,
      shared: { react: { chunks: true, build: 'package' } },
    });

    expect(warn).not.toHaveBeenCalled();
    expect(result.shared['react'].chunks).toBe(true);
  });

  it('includes shareScope only when configured', () => {
    expect(withNativeFederation({}).shareScope).toBeUndefined();
    expect(withNativeFederation({ shareScope: 'custom' }).shareScope).toBe('custom');
  });

  it('passes a per-external shareScope through normalization', () => {
    const result = withNativeFederation({
      shared: { react: { shareScope: 'isolated' } },
    });

    expect(result.shared['react'].shareScope).toBe('isolated');
  });

  it('builds shared mappings from the resolved tsconfig, filtering the skip list', () => {
    getRawMappedPaths.mockReturnValue({
      '/ws/libs/ui/index.ts': '@org/ui',
      '/ws/libs/skip/index.ts': '@org/skip',
    });

    const result = withNativeFederation({
      sharedMappings: ['@org/ui', '@org/skip'],
      skip: ['@org/skip'],
    });

    expect(findRootTsConfigJson).toHaveBeenCalled();
    expect(getRawMappedPaths).toHaveBeenCalledWith('/ws/tsconfig.json', ['@org/ui', '@org/skip']);
    expect(result.sharedMappings).toEqual({ '/ws/libs/ui/index.ts': '@org/ui' });
  });

  it('respects explicit feature flags', () => {
    const result = withNativeFederation({
      features: { mappingVersion: false, denseChunking: true },
    });

    expect(result.features).toEqual({
      mappingVersion: false,
      ignoreUnusedDeps: true,
      denseChunking: true,
      integrityHashes: false,
    });
  });

  it('passes the configured name and externals through', () => {
    const result = withNativeFederation({ name: 'mfe1', externals: ['rxjs'] });

    expect(result.name).toBe('mfe1');
    expect(result.externals).toEqual(['rxjs']);
  });
});
