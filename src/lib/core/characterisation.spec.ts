// Characterisation of today's shared and mapping selection: what a config publishes, per key, after
// normalize, planning and the record helpers (see __test-helpers__/characterisation/harness.ts).
//
// Rules for changing this file:
// - A snapshot change cites an INTENDED_DIFFS id in its PR, or it is a bug.
// - A row an intended diff covers is an explicit assertion named after that id (`D2: ...`), not a
//   snapshot, so the PR that changes it edits the assertion in view. It drops the obsolete snapshot
//   entry in the same change.
// - Rows keep their inputs as written today; a PR that changes a config form rewrites the inputs of
//   the rows using it, and leaves their expectations alone unless it cites a diff id.
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  characterise as characteriseAt,
  projected,
  type Files,
  type Row,
} from './__test-helpers__/characterisation/harness.js';
import {
  INTENDED_DIFFS,
  type IntendedDiffId,
} from './__test-helpers__/characterisation/intended-diffs.js';
import { densifyExternals } from './output/densify-externals.js';
import { DEFAULT_SKIP_LIST } from '../config/default-skip-list.js';
import { fromPackageJson, share, shareAll } from '../config/share-utils.js';
import { mappingsFromWorkspace } from '../config/mapping-utils.js';
import type { FederationConfig } from '../domain/config/federation-config.contract.js';

const workspaces: string[] = [];
afterEach(() => vi.restoreAllMocks());
afterAll(() => {
  for (const root of workspaces) fs.rmSync(root, { recursive: true, force: true });
});

// Each row gets a folder of its own, so no lookup cache can carry one row's packages into another.
function characterise(row: Row) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nf-characterisation-')));
  workspaces.push(root);
  for (const [file, content] of Object.entries(row.files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  }
  for (const [link, target] of Object.entries(row.links ?? {})) {
    fs.mkdirSync(path.dirname(path.join(root, link)), { recursive: true });
    fs.symlinkSync(path.join(root, target), path.join(root, link), 'junction');
  }
  return characteriseAt(row, root);
}

const AUTO = { singleton: true, strictVersion: true, requiredVersion: 'auto' } as const;

// The app: one exposed entry, src/main.ts, and the dependencies it declares.
function app(dependencies: Record<string, string>, extra: Files = {}): Files {
  return {
    'package.json': JSON.stringify({ name: 'shell', version: '1.0.0', dependencies }),
    'tsconfig.json': JSON.stringify({ compilerOptions: {} }),
    'federation.config.js': '',
    'src/main.ts': '',
    ...extra,
  };
}

// An installed package: an ESM `exports` package with one entry unless `manifest` says otherwise.
// `files` are relative to the package folder; index.js defaults to an empty module.
function installed(
  name: string,
  version: string,
  manifest: Record<string, unknown> = {},
  files: Record<string, string> = {},
  at = `node_modules/${name}`
): Files {
  const json = { name, version, type: 'module', exports: { '.': './index.js' }, ...manifest };
  return Object.fromEntries([
    [`${at}/package.json`, JSON.stringify(json)],
    ...Object.entries({ 'index.js': 'export {};', ...files }).map(([file, content]) => [
      `${at}/${file}`,
      content,
    ]),
  ]);
}

// Lazy: the config helpers read the workspace the config context names while the config loads.
const exposing =
  (shared: () => FederationConfig['shared'], extra: Partial<FederationConfig> = {}) =>
  (): FederationConfig => ({
    name: 'shell',
    exposes: { './Main': './src/main.ts' },
    shared: shared(),
    ...extra,
  });

// src/main.ts imports these packages and nothing else.
const mainImports = (...packages: string[]) => ({
  'src/main.ts': { 'src/main.ts': { packages } },
});

const snapshotRow = (id: string, title: string, row: () => Row) =>
  it(`${id}: ${title}`, async () => {
    expect(projected(await characterise(row()))).toMatchSnapshot();
  });

const intended = (id: IntendedDiffId, title: string, test: () => Promise<void>) =>
  it(`${id}: ${title}`, async () => {
    expect(INTENDED_DIFFS[id]).toBeDefined();
    await test();
  });

describe('characterisation: testing rows R1-R10', () => {
  snapshotRow('R1', 'a secondary reached only through another shared package', () => ({
    files: {
      ...app({ a: '^1.0.0', b: '^2.0.0' }),
      ...installed('a', '1.0.0', {}, { 'index.js': "import 'b/sub';" }),
      ...installed(
        'b',
        '2.0.0',
        { exports: { '.': './index.js', './sub': './sub.js' } },
        { 'sub.js': 'export {};' }
      ),
    },
    config: exposing(() => shareAll(AUTO)),
    scan: mainImports('a'),
  }));

  snapshotRow('R2', 'a package imported only by a computed specifier is pruned', () => ({
    files: {
      ...app(
        { a: '^1.0.0', icons: '^1.0.0' },
        { 'src/main.ts': "import 'a'; const name = 'icons'; import(name);" }
      ),
      ...installed('a', '1.0.0'),
      ...installed('icons', '1.0.0'),
    },
    config: exposing(() => shareAll(AUTO)),
    scan: mainImports('a'),
  }));

  snapshotRow('R3', 'keepAll keeps the secondaries of a reached package only', () => ({
    files: {
      ...app({ a: '^1.0.0', pre: '^1.0.0' }),
      ...installed(
        'a',
        '1.0.0',
        { exports: { '.': './index.js', './extra': './extra.js' } },
        { 'extra.js': 'export {};' }
      ),
      ...installed(
        'pre',
        '1.0.0',
        { exports: { '.': './index.js', './sub': './sub.js' } },
        { 'sub.js': 'export {};' }
      ),
    },
    config: exposing(() => shareAll({ ...AUTO, includeSecondaries: { keepAll: true } })),
    scan: mainImports('a'),
  }));

  snapshotRow('R4', 'a package reached transitively but not declared is not shared', () => ({
    files: {
      ...app({ a: '^1.0.0' }),
      ...installed('a', '1.0.0', {}, { 'index.js': "import 'peer';" }),
      ...installed('peer', '3.0.0'),
    },
    config: exposing(() => shareAll(AUTO)),
    scan: mainImports('a'),
  }));

  snapshotRow('R5', 'a root reached only through its secondary', () => ({
    files: {
      ...app({ p: '^1.0.0', q: '^1.0.0' }),
      ...installed(
        'p',
        '1.0.0',
        { exports: { '.': './index.js', './sub': './sub.js' } },
        { 'sub.js': 'export {};' }
      ),
      ...installed(
        'q',
        '1.0.0',
        { exports: { '.': './index.js', './sub': './sub.js' } },
        { 'sub.js': 'export {};' }
      ),
    },
    config: exposing(() =>
      share({ p: { ...AUTO }, q: { ...AUTO, includeSecondaries: { keepAll: true } } })
    ),
    scan: mainImports('p/sub', 'q/sub'),
  }));

  snapshotRow('R6', 'top-level skip drops a discovered secondary that is imported', () => ({
    files: {
      ...app({ lib: '^1.0.0' }),
      ...installed(
        'lib',
        '1.0.0',
        {
          exports: { '.': './index.js', './public': './public.js', './internal': './internal.js' },
        },
        { 'public.js': 'export {};', 'internal.js': 'export {};' }
      ),
    },
    config: exposing(() => shareAll(AUTO), { skip: ['lib/internal'] }),
    scan: mainImports('lib', 'lib/public', 'lib/internal'),
  }));

  intended(
    'D10',
    'R7, a shared key missing from package.json throws while the config loads',
    async () => {
      const outcome = await characterise({
        files: { ...app({ a: '^1.0.0' }), ...installed('a', '1.0.0') },
        config: exposing(() => share({ a: { ...AUTO }, ghost: { ...AUTO } })),
        scan: mainImports('a'),
      });

      expect(outcome).toMatchObject({
        throws: expect.stringContaining('Shared Dependency ghost has requiredVersion'),
      });
    }
  );

  intended('D8', 'R8, a browser shared bundle gets no Node built-ins', async () => {
    const projection = projected(
      await characterise({
        files: {
          ...app({ a: '^1.0.0' }),
          ...installed('a', '1.0.0', {}, { 'index.js': "import 'fs'; import 'node:path';" }),
        },
        config: exposing(() => shareAll(AUTO)),
        scan: mainImports('a'),
      })
    );

    expect(projection.bundles['browser-shared']!.externals).toEqual(['a']);
  });

  snapshotRow('R9', 'a cycle and a self-reference in the package graph terminate', () => ({
    files: {
      ...app({ a: '^1.0.0', b: '^1.0.0' }),
      ...installed('a', '1.0.0', {}, { 'index.js': "import 'b';" }),
      ...installed('b', '1.0.0', {}, { 'index.js': "import 'a'; import 'b';" }),
    },
    config: exposing(() => shareAll(AUTO)),
    scan: mainImports('a'),
  }));

  snapshotRow('R10', 'a chunks warning fires for a package that is pruned later', () => ({
    files: {
      ...app({ a: '^1.0.0', unused: '^1.0.0' }),
      ...installed('a', '1.0.0'),
      ...installed('unused', '1.0.0'),
    },
    config: exposing(() => fromPackageJson({ ...AUTO }).patch(['unused'], { chunks: false })),
    scan: mainImports('a'),
  }));
});

// An isolated install: every package lives under node_modules/.pnpm and sees only its own
// dependencies, linked next to it; the app's direct dependencies are linked into node_modules.
describe('characterisation: install layouts', () => {
  const store = (name: string, version: string) => `node_modules/.pnpm/${name}@${version}`;

  snapshotRow('I1', "a package reached only through a dependency's own install", () => ({
    files: {
      ...app({ a: '^1.0.0', d: '^1.0.0' }),
      ...installed(
        'a',
        '1.0.0',
        {},
        { 'index.js': "import 'c';" },
        `${store('a', '1.0.0')}/node_modules/a`
      ),
      ...installed(
        'c',
        '1.0.0',
        {},
        { 'index.js': "import 'd';" },
        `${store('c', '1.0.0')}/node_modules/c`
      ),
      ...installed('d', '1.0.0', {}, {}, `${store('d', '1.0.0')}/node_modules/d`),
    },
    links: {
      'node_modules/a': `${store('a', '1.0.0')}/node_modules/a`,
      'node_modules/d': `${store('d', '1.0.0')}/node_modules/d`,
      [`${store('a', '1.0.0')}/node_modules/c`]: `${store('c', '1.0.0')}/node_modules/c`,
    },
    config: exposing(() => shareAll(AUTO)),
    scan: mainImports('a'),
  }));

  // `a` has its own `c` (which imports `y`) next to it; the root's `c` imports `x`.
  snapshotRow('I2', "a shared package reached through a dependency is the root's install", () => ({
    files: {
      ...app({ a: '^1.0.0', c: '^1.0.0', x: '^1.0.0', y: '^1.0.0' }),
      ...installed(
        'a',
        '1.0.0',
        {},
        { 'index.js': "import 'c';" },
        `${store('a', '1.0.0')}/node_modules/a`
      ),
      ...installed('c', '1.0.0', {}, { 'index.js': "import 'x';" }),
      ...installed(
        'c',
        '2.0.0',
        {},
        { 'index.js': "import 'y';" },
        `${store('c', '2.0.0')}/node_modules/c`
      ),
      ...installed('x', '1.0.0'),
      ...installed('y', '1.0.0'),
    },
    links: {
      'node_modules/a': `${store('a', '1.0.0')}/node_modules/a`,
      [`${store('a', '1.0.0')}/node_modules/c`]: `${store('c', '2.0.0')}/node_modules/c`,
    },
    config: exposing(() => shareAll(AUTO)),
    scan: mainImports('a'),
  }));
});

describe('characterisation: config forms', () => {
  intended('D2', 'a raw object literal defaults singleton and strictVersion to false', async () => {
    const projection = projected(
      await characterise({
        files: { ...app({ rxjs: '^7.0.0' }), ...installed('rxjs', '7.8.1') },
        config: exposing(() => ({ rxjs: { requiredVersion: '^7.0.0' } })),
        scan: mainImports('rxjs'),
      })
    );

    expect(projection.shared['rxjs']).toMatchObject({ singleton: false, strictVersion: false });
  });

  intended('D26', 'a hand-written key without requiredVersion publishes "auto"', async () => {
    const projection = projected(
      await characterise({
        files: { ...app({ rxjs: '^7.0.0' }), ...installed('rxjs', '7.8.1') },
        config: exposing(() => ({ rxjs: { singleton: true, strictVersion: true } })),
        scan: mainImports('rxjs'),
      })
    );

    expect(projection.shared['rxjs']).toMatchObject({ requiredVersion: 'auto', version: '7.8.1' });
  });

  intended('D3', 'a missing shared shares every dependency something reaches', async () => {
    const projection = projected(
      await characterise({
        files: {
          ...app({ a: '^1.0.0', b: '^2.0.0' }),
          ...installed('a', '1.0.0'),
          ...installed('b', '2.0.0'),
        },
        config: exposing(() => undefined),
        scan: mainImports('a'),
      })
    );

    expect(projection.shared).toEqual({
      a: {
        bundle: 'browser-shared',
        entry: 'node_modules/a/index.js',
        version: '1.0.0',
        requiredVersion: '^1.0.0',
        singleton: true,
        strictVersion: true,
      },
    });
  });

  intended('D3', 'a missing sharedMappings shares every mapping something reaches', async () => {
    const projection = projected(
      await characterise({
        files: {
          ...app(
            {},
            {
              'tsconfig.json': JSON.stringify({
                compilerOptions: {
                  paths: {
                    '@org/ui': ['libs/ui/src/index.ts'],
                    '@org/utils': ['libs/utils/src/index.ts'],
                  },
                },
              }),
            }
          ),
          'libs/ui/package.json': JSON.stringify({ name: '@org/ui', version: '1.2.3' }),
          'libs/ui/src/index.ts': 'export {};',
          'libs/utils/package.json': JSON.stringify({ name: '@org/utils', version: '2.0.0' }),
          'libs/utils/src/index.ts': 'export {};',
        },
        config: exposing(() => ({})),
        scan: {
          'src/main.ts': { 'src/main.ts': { files: { 'libs/ui/src/index.ts': '@org/ui' } } },
        },
      })
    );

    expect(projection.mappings).toEqual({
      '@org/ui': {
        bundle: 'mapping-bundle',
        path: 'libs/ui/src/index.ts',
        version: '1.2.3',
        requiredVersion: '~1.2.3',
        singleton: true,
        strictVersion: true,
      },
    });
  });

  snapshotRow('C1', 'mappings with a build of their own and a declared package', () => ({
    files: {
      ...app(
        {},
        {
          'tsconfig.json': JSON.stringify({
            compilerOptions: {
              paths: {
                '@org/ui': ['libs/ui/src/index.ts'],
                '@org/utils': ['libs/utils/src/index.ts'],
                '@org/data/core': ['libs/data/core/index.ts'],
                '@org/data/http': ['libs/data/http/index.ts'],
              },
            },
          }),
        }
      ),
      'libs/ui/package.json': JSON.stringify({ name: '@org/ui', version: '1.2.3' }),
      'libs/ui/src/index.ts': 'export {};',
      'libs/utils/src/index.ts': 'export {};',
      'libs/data/package.json': JSON.stringify({ name: '@org/data', version: '3.1.0' }),
      'libs/data/core/index.ts': 'export {};',
      'libs/data/http/index.ts': 'export {};',
    },
    config: exposing(() => ({}), {
      sharedMappings: mappingsFromWorkspace()
        .patch(['@org/utils'], { build: 'separate' })
        .package('@org/data'),
    }),
    scan: {
      'src/main.ts': {
        'src/main.ts': {
          files: {
            'libs/ui/src/index.ts': '@org/ui',
            'libs/utils/src/index.ts': '@org/utils',
            'libs/data/core/index.ts': '@org/data/core',
            'libs/data/http/index.ts': '@org/data/http',
          },
        },
      },
    },
  }));

  snapshotRow('C2', 'no tsconfig shares no mappings', () => ({
    files: (() => {
      const files = app({ a: '^1.0.0' });
      delete files['tsconfig.json'];
      return { ...files, ...installed('a', '1.0.0') };
    })(),
    config: exposing(() => shareAll(AUTO)),
    scan: mainImports('a'),
    options: { tsConfig: undefined },
  }));

  snapshotRow('C3', 'a wildcard export', () => ({
    files: {
      ...app({ w: '^1.0.0' }),
      ...installed(
        'w',
        '1.0.0',
        { exports: { '.': './index.js', './*': './dist/*.js' } },
        { 'dist/a.js': 'export {};', 'dist/b.js': 'export {};' }
      ),
    },
    config: exposing(() => shareAll(AUTO)),
    scan: mainImports('w', 'w/a'),
  }));

  intended('D7', 'the secondaries of a package without exports are found by crawling', async () => {
    const projection = projected(
      await characterise({
        files: {
          ...app({ legacy: '^1.0.0' }),
          ...installed(
            'legacy',
            '1.0.0',
            { type: undefined, exports: undefined, main: 'index.js' },
            {
              'sub/package.json': JSON.stringify({ main: 'index.js' }),
              'sub/index.js': 'export {};',
              'internal/deep/package.json': JSON.stringify({ main: 'index.js' }),
              'internal/deep/index.js': 'export {};',
            }
          ),
        },
        config: exposing(() => shareAll({ ...AUTO, includeSecondaries: { keepAll: true } })),
        scan: mainImports('legacy'),
      })
    );

    expect(Object.keys(projection.shared).sort()).toEqual([
      'legacy',
      'legacy/internal/deep',
      'legacy/sub',
    ]);
  });

  snapshotRow('C4', 'every DEFAULT_SKIP_LIST entry', () => {
    const names = [
      ...DEFAULT_SKIP_LIST.filter(entry => typeof entry === 'string').map(entry =>
        entry.replace(/\/$/, '')
      ),
      '@types/node',
    ];
    return {
      files: {
        ...app(Object.fromEntries(names.map(name => [name, '^1.0.0']))),
        ...Object.assign({}, ...names.map(name => installed(name, '1.0.0'))),
      },
      config: exposing(() => shareAll(AUTO)),
      scan: mainImports(...names),
    };
  });

  snapshotRow('C5', 'two installed copies of one package record the hoisted one', () => ({
    files: {
      ...app({ a: '^1.0.0', b: '^1.0.0' }),
      ...installed('a', '1.0.0'),
      ...installed('b', '1.0.0', {}, { 'index.js': "import 'a';" }),
      ...installed('a', '2.0.0', {}, {}, 'node_modules/b/node_modules/a'),
    },
    config: exposing(() => shareAll(AUTO)),
    scan: mainImports('a', 'b'),
  }));

  snapshotRow('C6', "two package.json files declaring one name: the app's wins", () => ({
    files: {
      ...app({ rxjs: '^7.0.0' }),
      'apps/shell/package.json': JSON.stringify({
        name: 'shell-app',
        version: '1.0.0',
        dependencies: { rxjs: '~7.8.0' },
      }),
      'apps/shell/src/main.ts': '',
      ...installed('rxjs', '7.8.1'),
    },
    config: () => ({
      name: 'shell',
      exposes: { './Main': './apps/shell/src/main.ts' },
      shared: shareAll(AUTO),
    }),
    scan: { 'apps/shell/src/main.ts': { 'apps/shell/src/main.ts': { packages: ['rxjs'] } } },
    options: { packageJson: 'apps/shell/package.json' },
  }));

  intended('D27', 'several shareAll spreads union, the last spread winning per key', async () => {
    const projection = projected(
      await characterise({
        files: {
          ...app({ rxjs: '^7.8.0' }),
          'libs/a/package.json': JSON.stringify({
            name: 'lib-a',
            version: '1.0.0',
            dependencies: { rxjs: '~7.5.0', lodash: '^4.0.0' },
          }),
          ...installed('rxjs', '7.8.1'),
          ...installed('lodash', '4.17.21'),
        },
        config: exposing(() => ({
          ...shareAll(AUTO, { projectPath: 'libs/a' }),
          ...shareAll(AUTO),
        })),
        scan: mainImports('rxjs', 'lodash'),
      })
    );

    expect(projection.shared['rxjs']).toMatchObject({ requiredVersion: '^7.8.0' });
    expect(projection.shared['lodash']).toMatchObject({ requiredVersion: '^4.0.0' });
  });

  snapshotRow('C7', 'a declared range per protocol', () => ({
    files: {
      ...app({
        cat: 'catalog:',
        ws: 'workspace:*',
        alias: 'npm:real@^1.0.0',
        local: 'file:../local',
      }),
      ...installed('cat', '2.1.0'),
      ...installed('ws', '0.3.0'),
      ...installed('real', '1.2.0', {}, {}, 'node_modules/alias'),
      ...installed('local', '5.0.0'),
    },
    config: exposing(() => shareAll(AUTO)),
    scan: mainImports('cat', 'ws', 'alias', 'local'),
  }));

  intended('D23', 'a declared version is a fallback behind the installed one', async () => {
    const projection = projected(
      await characterise({
        files: { ...app({ core: '^17.0.0' }), ...installed('core', '17.3.5') },
        config: exposing(() =>
          share({
            core: {
              singleton: true,
              strictVersion: true,
              version: '17.0.0',
              requiredVersion: '^17.0.0',
            },
          })
        ),
        scan: mainImports('core'),
      })
    );

    expect(projection.shared['core']).toMatchObject({
      version: '17.3.5',
      requiredVersion: '^17.0.0',
    });
  });

  intended('D24', 'a hand-written subpath key is shared as its own entry', async () => {
    const projection = projected(
      await characterise({
        files: {
          ...app({ rxjs: '^7.0.0' }),
          ...installed(
            'rxjs',
            '7.8.1',
            { exports: { '.': './index.js', './operators': './operators.js' } },
            { 'operators.js': 'export {};' }
          ),
        },
        config: exposing(() =>
          share({
            rxjs: { ...AUTO, includeSecondaries: false },
            'rxjs/operators': { ...AUTO, includeSecondaries: false },
          })
        ),
        scan: mainImports('rxjs', 'rxjs/operators'),
      })
    );

    expect(projection.shared['rxjs/operators']).toMatchObject({
      entry: 'node_modules/rxjs/operators.js',
      version: '7.8.1',
    });
  });

  intended(
    'D28',
    'entries of one package with different metadata split into two records',
    async () => {
      const outcome = await characterise({
        files: {
          ...app({ p: '^1.0.0' }),
          ...installed(
            'p',
            '1.0.0',
            { exports: { '.': './index.js', './sub': './sub.js' } },
            { 'sub.js': 'export {};' }
          ),
        },
        config: exposing(() => ({
          p: { singleton: true, strictVersion: true, requiredVersion: '^1.0.0' },
          'p/sub': { singleton: false, strictVersion: false, requiredVersion: '^1.0.0' },
        })),
        scan: mainImports('p', 'p/sub'),
      });
      if ('throws' in outcome) throw new Error(outcome.throws);

      const dense = densifyExternals(outcome.records, new Map());
      expect(dense.map(record => [record.packageName, record.singleton])).toEqual([
        ['p', true],
        ['p', false],
      ]);
      expect(outcome.projection.warnings).toEqual([]);
    }
  );

  const preloadedPool = (): Row => ({
    files: {
      ...app({ a: '^1.0.0', b: '^1.0.0', c: '^1.0.0' }),
      ...installed('a', '1.0.0'),
      ...installed('b', '1.0.0'),
      ...installed('c', '1.0.0'),
    },
    config: exposing(() =>
      fromPackageJson().patch(['b', 'c'], { build: 'pool', pool: 'core', preload: true })
    ),
    scan: mainImports('a', 'b', 'c'),
  });

  // C8's warnings are D29 and D30, so a change to one edits only its own row.
  it('C8: fromPackageJson defaults give every package a bundle; a pool shares one', async () => {
    const { warnings, ...projection } = projected(await characterise(preloadedPool()));
    expect(warnings).toHaveLength(2);
    expect(projection).toMatchSnapshot();
  });

  intended('D29', 'C8, preload without features.denseChunking warns', async () => {
    const { warnings } = projected(await characterise(preloadedPool()));

    expect(warnings).toContain(
      "Shared externals 'b', 'c' set preload, but without features.denseChunking the runtime preloads only their entry files, not their chunks. Enable features.denseChunking to preload those too."
    );
  });

  intended('D30', 'C8, preload in a pool warns that the whole bundle preloads', async () => {
    const { warnings } = projected(await characterise(preloadedPool()));

    expect(warnings).toContain(
      "Shared externals 'b', 'c' set preload, but are built in a bundle with other packages (the combined shared bundle or a pool), so the runtime preloads the chunks of every package in it. Give them a bundle of their own with build: 'package'."
    );
  });
});

describe('characterisation: entry points scanned', () => {
  const files = {
    ...app({ a: '^1.0.0', b: '^1.0.0' }, { 'src/other.ts': '' }),
    ...installed('a', '1.0.0'),
    ...installed('b', '1.0.0'),
  };
  const scan = {
    'src/main.ts': { 'src/main.ts': { packages: ['a'] } },
    'src/other.ts': { 'src/other.ts': { packages: ['b'] } },
  };

  snapshotRow('C9', 'exposes only', () => ({
    files,
    config: exposing(() => shareAll(AUTO)),
    scan,
  }));

  snapshotRow('C10', 'adapter entryPoints only', () => ({
    files,
    config: () => ({ name: 'shell', shared: shareAll(AUTO) }),
    scan,
    options: { entryPoints: ['src/other.ts'] },
  }));

  intended('D4', 'adapter entryPoints are not scanned next to exposes', async () => {
    const projection = projected(
      await characterise({
        files,
        config: exposing(() => shareAll(AUTO)),
        scan,
        options: { entryPoints: ['src/other.ts'] },
      })
    );

    expect(Object.keys(projection.shared)).toEqual(['a']);
  });
});

// How an `exports` entry resolves today. Hand-written keys, so the resolver runs for each one.
describe('characterisation: exports resolution', () => {
  const resolving = (key: string, exports: unknown, files: Record<string, string>): Row => ({
    files: {
      ...app({ p: '^1.0.0' }),
      ...installed('p', '1.0.0', { exports, main: 'main.js' }, { 'main.js': '', ...files }),
    },
    config: exposing(() => share({ [key]: { ...AUTO, includeSecondaries: false } })),
    scan: mainImports(key),
  });

  snapshotRow('E1', 'a null target is not exported', () =>
    resolving('p', { '.': null, './x': './x.js' }, { 'x.js': '' })
  );

  snapshotRow('E2', "an exact key wins over './*' listed before it", () =>
    resolving(
      'p/sub',
      { '.': './index.js', './*': './dist/*.js', './sub': './sub/index.js' },
      { 'dist/sub.js': '', 'sub/index.js': '' }
    )
  );

  snapshotRow('E3', 'the pattern with the longer prefix wins', () =>
    resolving(
      'p/a/b/c',
      { '.': './index.js', './a/*': './x/*.js', './a/b/*': './y/*.js' },
      { 'x/b/c.js': '', 'y/c.js': '' }
    )
  );

  snapshotRow('E4', 'a pattern with a suffix after the star matches', () =>
    resolving(
      'p/feature.js',
      { '.': './index.js', './*.js': './dist/*.js' },
      { 'dist/feature.js': '' }
    )
  );

  snapshotRow('E5', 'a target with two stars replaces both', () =>
    resolving('p/a', { '.': './index.js', './*': './dist/*/*.js' }, { 'dist/a/a.js': '' })
  );

  snapshotRow('E6', 'an array skips a target that leaves the package', () =>
    resolving('p', { '.': ['../outside.js', './index.js'] }, {})
  );

  snapshotRow('E7', 'a browser build skips the node condition', () =>
    resolving(
      'p',
      { '.': { node: './node.js', browser: './browser.js' } },
      {
        'node.js': '',
        'browser.js': '',
      }
    )
  );

  snapshotRow('E8', 'an array skips an element whose matching condition is null', () =>
    resolving('p', { '.': [{ import: null }, './index.js'] }, {})
  );
});
