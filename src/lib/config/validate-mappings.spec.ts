import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertBarrelMappings,
  assertPrebuiltMappings,
  explainMissingMappedPath,
  isNonBarrelImport,
} from './validate-mappings.js';
import { createMemoryIo } from '../utils/io/__test-helpers__/memory-io.js';
import * as path from 'path';
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

const ROOT = path.resolve('/ws');
const p = (...segs: string[]) => path.join(ROOT, ...segs);

describe('explainMissingMappedPath', () => {
  const io = createMemoryIo().setDir(p('dist/ui')).setFile(p('libs/url/src/public-api.ts'), '');

  it('names the mapping, its path, and what to do about it', () => {
    expect(() => explainMissingMappedPath(io, { [p('dist/gone')]: '@org/gone' })).toThrow(
      /'@org\/gone'.*does not exist.*build that library before the app/s
    );
  });

  it('counts the others without listing them all', () => {
    expect(() =>
      explainMissingMappedPath(io, {
        [p('dist/gone')]: '@org/gone',
        [p('dist/also-gone')]: '@org/also-gone',
      })
    ).toThrow(/and 1 other mapping/);
  });

  // The caller re-throws sheriff's own error when nothing here explains it.
  it('returns quietly when every mapped path exists', () => {
    expect(() =>
      explainMissingMappedPath(io, {
        [p('dist/ui')]: '@org/ui',
        [p('libs/url/src/public-api.ts')]: '@org/url',
      })
    ).not.toThrow();
  });

  // Wildcards are patterns, not locations; they only become real once expanded.
  it('ignores wildcard mappings', () => {
    expect(() =>
      explainMissingMappedPath(io, { [p('libs', '*', 'src')]: '@org/*' })
    ).not.toThrow();
  });
});

describe('assertPrebuiltMappings', () => {
  const isPackage = (candidate: string) => candidate === p('dist/ui');

  it('passes when every mapping is a built package', () => {
    expect(() => assertPrebuiltMappings({ [p('dist/ui')]: '@org/ui' }, isPackage)).not.toThrow();
  });

  it('names the mappings that still resolve to source', () => {
    expect(() =>
      assertPrebuiltMappings(
        { [p('dist/ui')]: '@org/ui', [p('libs/url/src/public-api.ts')]: '@org/url' },
        isPackage
      )
    ).toThrow(/'prebuiltMappings'.*built package.*'@org\/url'/s);
  });
});
