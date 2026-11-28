import { describe, expect, it } from 'vitest';
import { alignToPackages, packageSources } from './package-config.js';
import { inferPackageFromSecondary } from '../utils/normalize.js';
import type { ExternalConfig } from '../domain/config/external-config.contract.js';

describe('packageSources', () => {
  it('picks the main entry wherever it is listed', () => {
    const sources = packageSources(
      ['rxjs/operators', 'rxjs', 'rxjs/ajax'],
      inferPackageFromSecondary
    );
    expect([...sources]).toEqual([['rxjs', 'rxjs']]);
  });

  it('picks the first entry point listed when there is no main entry', () => {
    const sources = packageSources(['@org/ui/table', '@org/ui/button'], inferPackageFromSecondary);
    expect([...sources]).toEqual([['@org/ui', '@org/ui/table']]);
  });

  // Mappings outside a .package() declaration are their own package.
  it('keeps every name apart under an identity grouping', () => {
    const sources = packageSources(['@org/ui/table', '@org/ui/button'], name => name);
    expect([...sources]).toEqual([
      ['@org/ui/table', '@org/ui/table'],
      ['@org/ui/button', '@org/ui/button'],
    ]);
  });
});

describe('alignToPackages', () => {
  it('reports each field an entry point sets apart, once per package', () => {
    const { configs, ignored } = alignToPackages<ExternalConfig>(
      {
        rxjs: { singleton: true },
        'rxjs/operators': { singleton: false, pool: 'a' },
        'rxjs/ajax': { singleton: false, shareScope: 's' },
        tslib: { singleton: false },
      },
      inferPackageFromSecondary
    );

    expect(configs['rxjs/operators']).toEqual({ singleton: true });
    expect(configs['tslib']).toEqual({ singleton: false });
    expect(ignored).toEqual([
      { packageName: 'rxjs', source: 'rxjs', fields: ['singleton', 'pool', 'shareScope'] },
    ]);
  });

  it('takes every package field from the source and keeps the rest', () => {
    const { configs } = alignToPackages<ExternalConfig>(
      {
        rxjs: { singleton: true, build: 'package', chunks: false },
        'rxjs/operators': {
          singleton: false,
          build: 'pool',
          pool: 'x',
          platform: 'node',
          includeSecondaries: true,
        },
      },
      inferPackageFromSecondary
    );

    expect(configs['rxjs/operators']).toEqual({
      singleton: true,
      build: 'package',
      chunks: false,
      platform: 'node',
      includeSecondaries: true,
    });
  });

  // An own value the source leaves unset would otherwise pair with the source's build.
  it('drops a package field the source leaves unset, and reports it', () => {
    const { configs, ignored } = alignToPackages<ExternalConfig>(
      { rxjs: {}, 'rxjs/operators': { pool: 'x', preload: true } },
      inferPackageFromSecondary
    );

    expect(configs['rxjs/operators']).toEqual({});
    expect(ignored).toEqual([{ packageName: 'rxjs', source: 'rxjs', fields: ['pool', 'preload'] }]);
  });

  it('lets an entry point that leaves a field unset inherit it without a report', () => {
    const { configs, ignored } = alignToPackages<ExternalConfig>(
      { rxjs: { build: 'package', chunks: false }, 'rxjs/operators': {} },
      inferPackageFromSecondary
    );

    expect(configs['rxjs/operators']).toEqual({ build: 'package', chunks: false });
    expect(ignored).toEqual([]);
  });

  // Key order in a nested value is how it was written, not what it means.
  it('compares nested values by meaning', () => {
    const { ignored } = alignToPackages<{ requiredVersion?: unknown }>(
      {
        rxjs: { requiredVersion: { version: 'auto', range: '^' } },
        'rxjs/operators': { requiredVersion: { range: '^', version: 'auto' } },
      },
      inferPackageFromSecondary
    );

    expect(ignored).toEqual([]);
  });
});
