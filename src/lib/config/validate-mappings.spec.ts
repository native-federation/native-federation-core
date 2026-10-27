import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertBarrelMappings,
  assertMappingPackagePrefixes,
  assertNoConfigUnderMappingPackage,
  isNonBarrelImport,
  isNpmStylePackage,
  warnNonNpmMappingNames,
  warnUnmatchedMappingPackages,
} from './validate-mappings.js';
import { logger } from '../utils/logger.js';

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

describe('assertMappingPackagePrefixes', () => {
  it.each([
    ['@org/lib'],
    ['@org/lib/testing'],
    ['@events/evaluation/core'],
    ['lib'],
    ['libs/ui'],
    ['~app/utils'],
  ])('accepts %s', prefix => {
    expect(() => assertMappingPackagePrefixes([prefix])).not.toThrow();
  });

  // '@org' would be coarser than the name rule; the rest are not a name at all.
  it.each([['@org'], ['@org/'], ['@org/lib/'], ['@org/lib/*'], ['@org/*/x'], ['@org//lib'], ['']])(
    'rejects %j',
    prefix => {
      expect(() => assertMappingPackagePrefixes([prefix])).toThrow(/is not a package name/);
    }
  );
});

describe('assertNoConfigUnderMappingPackage', () => {
  it.each([['@org/lib'], ['@org/lib/testing'], ['@org/lib/*']])(
    'rejects a config for %s under the declared package',
    pattern => {
      expect(() => assertNoConfigUnderMappingPackage([pattern], ['@org/lib'])).toThrow(
        `Shared mapping config '${pattern}' sits under declared package '@org/lib'`
      );
    }
  );

  // A broader pattern still configures every mapping outside the package.
  it.each([['@org/library'], ['@org/*'], ['@org/lib*'], ['*'], ['@other/lib']])(
    'lets %s through',
    pattern => {
      expect(() => assertNoConfigUnderMappingPackage([pattern], ['@org/lib'])).not.toThrow();
    }
  );
});

describe('warnUnmatchedMappingPackages', () => {
  afterEach(() => vi.restoreAllMocks());

  const keys = ['@s/c/t', '@s/c/t/sort', '@d/*', '@e/x/*', '@f/li*'];

  // Declarations live in a module every remote imports, so one only matters if no key reaches it.
  it.each([['@s/c/t'], ['@s/c'], ['@d/lib'], ['@d/lib/sub'], ['@e/x'], ['@f/lib']])(
    'stays quiet for %s, which a key reaches',
    prefix => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
      warnUnmatchedMappingPackages([prefix], keys);
      expect(warn).not.toHaveBeenCalled();
    }
  );

  it.each([['@s/c/table'], ['@s/c/t/sort/x'], ['@other/lib'], ['@f/other']])(
    'warns for %s',
    prefix => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
      warnUnmatchedMappingPackages([prefix], keys);
      expect(warn).toHaveBeenCalledWith(
        `Shared mapping package '${prefix}' covers no tsconfig paths key.`
      );
    }
  );

  // A catch-all key (ambient types, say) would reach any prefix, so it cannot hide a typo.
  it.each([['*'], ['*/index']])('still warns next to the catch-all key %s', key => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    warnUnmatchedMappingPackages(['@typo/lib'], [key]);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
