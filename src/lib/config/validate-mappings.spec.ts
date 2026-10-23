import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertBarrelMappings,
  assertOneConfigPerPathsPackage,
  isNonBarrelImport,
  isNpmStylePackage,
  warnNonNpmMappingNames,
} from './validate-mappings.js';
import { logger } from '../utils/logger.js';
import type {
  NormalizedFederationConfig,
  NormalizedMappingConfig,
} from '../domain/config/federation-config.contract.js';

describe('isNonBarrelImport', () => {
  it('accepts barrel specifiers', () => {
    expect(['@org/ui', '@org/ui/button', 'lodash-es'].filter(isNonBarrelImport)).toEqual([]);
  });

  // The cases the Angular adapter's checkForInvalidImports rejects; kept in lockstep with it.
  it('rejects a dot in the last segment', () => {
    expect(
      ['@org/ui/button.component', 'lodash.merge', '@scope/lib.v2'].filter(isNonBarrelImport)
    ).toEqual(['@org/ui/button.component', 'lodash.merge', '@scope/lib.v2']);
  });

  it('allows a real file extension', () => {
    expect(['@org/ui/button.js', '@org/data/schema.json'].filter(isNonBarrelImport)).toEqual([]);
  });

  // A dot in an earlier segment is fine — only the resolved last segment matters.
  it('ignores dots outside the last segment', () => {
    expect(isNonBarrelImport('@org/v1.2/button')).toBe(false);
  });

  it('strips a query or hash before judging', () => {
    expect(isNonBarrelImport('@org/ui/button?raw')).toBe(false);
    expect(isNonBarrelImport('@org/ui/button.component?raw')).toBe(true);
  });
});

describe('assertBarrelMappings', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes a barrel-only mapping set', () => {
    expect(() => assertBarrelMappings({ '/ws/libs/ui/index.ts': '@org/ui' })).not.toThrow();
  });

  it('throws and names every offender', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    expect(() =>
      assertBarrelMappings({
        '/ws/libs/ui/index.ts': '@org/ui',
        '/ws/libs/ui/button/button.component.ts': '@org/ui/button/button.component',
      })
    ).toThrow(/'@org\/ui\/button\/button\.component'/);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Only barrel imports can be shared'));
  });

  // Same declarative sentence whatever the count or the source of the mapping.
  it('states the rule and lists the offenders', () => {
    vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    expect(() => assertBarrelMappings({ '/a.ts': '@org/a.service' })).toThrow(
      "Invalid 'shared mappings' config. Only barrel imports can be shared as a sharedMapping: '@org/a.service'."
    );

    expect(() =>
      assertBarrelMappings({ '/a.ts': '@org/a.service', '/b.ts': '@org/b.service' })
    ).toThrow(
      "Invalid 'shared mappings' config. Only barrel imports can be shared as a sharedMapping: '@org/a.service', '@org/b.service'."
    );
  });

  // A shareAll workspace can produce a lot of these; the warnings still list every one.
  it('truncates a long offender list but warns about each', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const paths = Object.fromEntries(
      Array.from({ length: 8 }, (_, i) => [`/lib${i}.ts`, `@org/lib${i}.service`])
    );

    expect(() => assertBarrelMappings(paths)).toThrow(/and 3 more\.$/);
    expect(warn).toHaveBeenCalledTimes(8);
  });
});

describe('isNpmStylePackage', () => {
  it('accepts plain and scoped package names, with or without a subpath', () => {
    expect(
      ['shared', '@org/ui', '@org/ui/button', 'my-lib/feature', '@org/ui.v2', '@org/*'].filter(
        name => !isNpmStylePackage(name)
      )
    ).toEqual([]);
  });

  it('rejects names npm would not publish', () => {
    expect(
      [
        '@shared',
        '~app/utils',
        '#internal',
        '@Org/ui',
        'Shared',
        '_private',
        '.hidden',
        '@/utils',
      ].filter(isNpmStylePackage)
    ).toEqual([]);
  });
});

describe('warnNonNpmMappingNames', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stays quiet for npm-style names', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    warnNonNpmMappingNames({ '/ws/libs/ui/index.ts': '@org/ui' });
    expect(warn).not.toHaveBeenCalled();
  });

  // Secondaries of one offending package collapse into a single warning.
  it('warns once per offending package', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    warnNonNpmMappingNames({
      '/ws/libs/a/index.ts': '~app/a',
      '/ws/libs/b/index.ts': '~app/b',
      '/ws/libs/ui/index.ts': '@org/ui',
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("'~app'"));
  });

  // features.strictImports turns the warning into a build error.
  it('throws when strict, naming every offending package', () => {
    vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    expect(() =>
      warnNonNpmMappingNames(
        { '/ws/libs/a/index.ts': '~app/a', '/ws/libs/s/index.ts': '@shared' },
        true
      )
    ).toThrow(
      "Invalid 'shared mappings' config. Shared mappings must follow npm package naming ('package' or '@company/package', subpaths belong to that package): '~app', '@shared'."
    );
  });

  it('does not throw when strict and every name is npm-style', () => {
    expect(() => warnNonNpmMappingNames({ '/ws/libs/ui/index.ts': '@org/ui' }, true)).not.toThrow();
  });
});

describe('assertOneConfigPerPathsPackage', () => {
  const paths: NormalizedMappingConfig = { singleton: true, strictVersion: false, build: 'paths' };
  const config = (
    sharedMappingsConfig: Record<string, NormalizedMappingConfig>,
    sharedMappingKeys: string[] | undefined = ['@org/ui', '@org/ui/*', '@org/forms']
  ) =>
    ({
      sharedMappings: {
        './ui': '@org/ui',
        './ui/button': '@org/ui/button',
        './forms': '@org/forms',
      },
      sharedMappingsConfig,
      sharedMappingKeys,
      features: { mappingVersion: false },
    }) as unknown as NormalizedFederationConfig;

  it('passes a package whose mappings share one config', () => {
    expect(() => assertOneConfigPerPathsPackage(config({ '*': paths }))).not.toThrow();
  });

  // The pruning flags never reach the published record.
  it('ignores includeSecondaries and resolveGlob', () => {
    const cfg = config({ '@org/ui': { ...paths, includeSecondaries: true }, '*': paths });
    expect(() => assertOneConfigPerPathsPackage(cfg)).not.toThrow();
  });

  it('rejects a package whose mappings would publish different records', () => {
    const cfg = config({ '@org/ui': { ...paths, singleton: false }, '*': paths });
    expect(() => assertOneConfigPerPathsPackage(cfg)).toThrow(
      /'@org\/ui' and '@org\/ui\/button' belong to tsconfig paths package '@org\/ui' but are configured differently/
    );
  });

  // Otherwise `@org/ui/button` lands in the default bundle and `@org/ui` in its own.
  it('rejects a package that is only partly built as paths', () => {
    const cfg = config({ '@org/ui': paths, '@org/forms': paths });
    expect(() => assertOneConfigPerPathsPackage(cfg)).toThrow(/configured differently/);
  });

  // `@org/ui/x` has a key of its own, but without 'paths' it is published under its name-rule
  // package `@org/ui`, from the default bundle where it can share a chunk with `@org/other`.
  it('rejects a mapping without paths that its name would publish under a paths package', () => {
    const cfg = {
      sharedMappings: { './ui': '@org/ui', './ui/x': '@org/ui/x', './other': '@org/other' },
      sharedMappingsConfig: { '@org/ui': paths },
      sharedMappingKeys: ['@org/ui', '@org/ui/x', '@org/other'],
      features: { mappingVersion: false },
    } as unknown as NormalizedFederationConfig;

    expect(() => assertOneConfigPerPathsPackage(cfg)).toThrow(
      `Shared mappings '@org/ui' and '@org/ui/x' belong to tsconfig paths package '@org/ui' but are configured differently (build: "paths" vs undefined)`
    );
  });

  // Its key would put `row` in the paths package `@shared/components/table`, but without 'paths' it
  // keeps the name rule and is published under `@shared/components`: nothing merges.
  it('lets a mapping without paths keep the name rule under a paths key', () => {
    const cfg = {
      sharedMappings: {
        './table': '@shared/components/table',
        './table/row': '@shared/components/table/row',
      },
      sharedMappingsConfig: { '@shared/components/table': paths },
      sharedMappingKeys: ['@shared/components/table', '@shared/components/table/*'],
      features: { mappingVersion: false },
    } as unknown as NormalizedFederationConfig;

    expect(() => assertOneConfigPerPathsPackage(cfg)).not.toThrow();
  });

  it('reads a nested config the same whatever its key order', () => {
    const cfg = config({
      '@org/ui': { ...paths, requiredVersion: { version: 'auto', range: '^' } },
      '*': { ...paths, requiredVersion: { range: '^', version: 'auto' } },
    });
    expect(() => assertOneConfigPerPathsPackage(cfg)).not.toThrow();
  });

  it('leaves packages without a paths mapping alone', () => {
    const cfg = config({ '@org/forms': paths, '@org/ui': { ...paths, build: 'separate' } });
    expect(() => assertOneConfigPerPathsPackage(cfg)).not.toThrow();
  });

  it('does nothing without build: paths', () => {
    const cfg = config({ '@org/ui': { singleton: false, strictVersion: false } }, undefined);
    expect(() => assertOneConfigPerPathsPackage(cfg)).not.toThrow();
  });
});
