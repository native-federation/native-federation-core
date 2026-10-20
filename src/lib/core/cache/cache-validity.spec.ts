import { describe, expect, it } from 'vitest';
import { createMemoryIo } from '../../utils/io/__test-helpers__/memory-io.js';
import { createPackageJsonRepository } from '../../utils/io/package-json-repository.js';
import type { CacheMetadata } from './cache-persistence.js';
import {
  dependencyClosureCore,
  externalImportsCore,
  staleCacheReason,
} from './cache-validity.js';

describe('externalImportsCore', () => {
  const mem = createMemoryIo()
    .setFile(
      '/b/entry.js',
      [
        "import { a } from '@scope/ui/button';",
        "import 'rxjs';",
        "import fs from 'fs';",
        "import './local.js';",
        "export const lazy = () => import('lazy-lib');",
      ].join('\n')
    )
    .setFile('/b/entry.js.map', '{}');

  it('records only the bare imports the external list kept, including dynamic ones', () => {
    expect(
      externalImportsCore(mem, '/b', ['entry.js', 'entry.js.map'], ['@scope/*', 'rxjs', 'lazy-lib'])
    ).toEqual(['@scope/ui/button', 'lazy-lib', 'rxjs']);
  });

  // A node bundle keeps built-ins bare without being told; they must not pin the entry.
  it('leaves out what the bundler kept on its own', () => {
    expect(externalImportsCore(mem, '/b', ['entry.js'], ['rxjs'])).toEqual(['rxjs']);
  });
});

describe('dependencyClosureCore', () => {
  it('follows dependencies, peers and optional deps, resolving nested installs first', () => {
    const mem = createMemoryIo()
      .setFile(
        '/ws/node_modules/foo/package.json',
        '{"dependencies":{"bar":"1"},"peerDependencies":{"@scope/peer":"1"}}'
      )
      .setFile('/ws/node_modules/foo/node_modules/bar/package.json', '{"dependencies":{"deep":"1"}}')
      .setFile('/ws/node_modules/bar/package.json', '{"dependencies":{"wrong":"1"}}')
      .setFile('/ws/node_modules/@scope/peer/package.json', '{"optionalDependencies":{"opt":"1"}}')
      .setFile('/ws/node_modules/deep/package.json', '{"dependencies":{"foo":"1"}}');

    const closure = dependencyClosureCore(['foo/sub'], '/ws', createPackageJsonRepository(mem));

    // `opt` is not installed but is still a name the bundle may import; `wrong` is never reached.
    expect([...closure].sort()).toEqual(['@scope/peer', 'bar', 'deep', 'foo', 'opt']);
  });
});

describe('staleCacheReason', () => {
  const meta = (fields: Partial<CacheMetadata>): CacheMetadata => ({
    checksum: 'x',
    externals: [],
    files: [],
    builtExternals: ['rxjs', '@angular/core'],
    externalImports: ['rxjs/operators', '@angular/core'],
    ...fields,
  });
  const none = () => new Set<string>();

  it('accepts the list it was built against, in any order', () => {
    expect(staleCacheReason(meta({}), ['@angular/core', 'rxjs'], none)).toBeUndefined();
  });

  it('rejects an entry whose import is no longer covered', () => {
    expect(staleCacheReason(meta({}), ['rxjs'], none)).toMatch(/'@angular\/core'/);
  });

  it('accepts a wildcard that still covers the import', () => {
    expect(staleCacheReason(meta({}), ['rxjs', '@angular/*'], none)).toBeUndefined();
  });

  it('rejects a new external only when the entries reach its package', () => {
    const reach = () => new Set(['@angular/common']);
    const current = ['rxjs', '@angular/core', '@angular/common/http'];
    expect(staleCacheReason(meta({}), current, reach)).toMatch(/'@angular\/common\/http'/);
    expect(staleCacheReason(meta({}), [...current.slice(0, 2), 'other'], reach)).toBeUndefined();
  });

  it('does not walk dependencies unless something was added', () => {
    let walked = false;
    staleCacheReason(meta({}), ['rxjs', '@angular/core'], () => {
      walked = true;
      return new Set();
    });
    expect(walked).toBe(false);
  });

  it('rejects metadata that predates the recorded list', () => {
    expect(
      staleCacheReason(meta({ builtExternals: undefined }), ['rxjs', '@angular/core'], none)
    ).toBeDefined();
  });
});
