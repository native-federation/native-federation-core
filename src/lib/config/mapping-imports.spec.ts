import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as path from 'path';
import { createMappingImportResolver, mappingExportNames } from './mapping-imports.js';
import { createMemoryIo } from '../utils/io/__test-helpers__/memory-io.js';
import { logger } from '../utils/logger.js';

const ROOT = path.resolve('/proj');
const f = (rel: string) => path.join(ROOT, rel);

const names = (io: ReturnType<typeof createMemoryIo>, file: string) =>
  [...mappingExportNames(file, io)].sort();

describe('mappingExportNames', () => {
  it('collects value declarations carrying an export modifier', () => {
    const io = createMemoryIo().setFile(
      f('a.ts'),
      `export class A {}
       export function b() {}
       export const c = 1;
       export enum D {}
       class Hidden {}`
    );
    expect(names(io, f('a.ts'))).toEqual(['A', 'D', 'b', 'c']);
  });

  it('skips types, which are erased and would resolve to undefined after a rewrite', () => {
    const io = createMemoryIo()
      .setFile(
        f('a.ts'),
        `export interface Props {}
       export type Alias = string;
       export type { Gone } from './other';
       export { type AlsoGone, Kept } from './other';`
      )
      // Real, so the walk can read where `Kept` comes from; a re-export it cannot resolve is
      // dropped rather than credited to this file.
      .setFile(f('other.ts'), `export class Kept {} export class AlsoGone {}`);
    expect(names(io, f('a.ts'))).toEqual(['Kept']);
  });

  it('follows `export * from` transitively', () => {
    const io = createMemoryIo()
      .setFile(f('index.ts'), `export * from './mod';`)
      .setFile(f('mod.ts'), `export * from './leaf'; export class Mod {}`)
      .setFile(f('leaf.ts'), `export class Leaf {}`);
    expect(names(io, f('index.ts'))).toEqual(['Leaf', 'Mod']);
  });

  it('records the local name of a renaming re-export, not the original', () => {
    const io = createMemoryIo()
      .setFile(f('index.ts'), `export { Badge as PublicBadge } from './badge';`)
      .setFile(f('badge.ts'), `export class Badge {}`);
    expect(names(io, f('index.ts'))).toEqual(['PublicBadge']);
  });

  it('names a namespace re-export once and does not inline its contents', () => {
    const io = createMemoryIo()
      .setFile(f('index.ts'), `export * as utils from './utils';`)
      .setFile(f('utils.ts'), `export const helper = 1;`);
    expect(names(io, f('index.ts'))).toEqual(['utils']);
  });

  it('reports a default export under the name a namespace access would use', () => {
    const io = createMemoryIo().setFile(f('a.ts'), `export default class A {}`);
    expect(names(io, f('a.ts'))).toEqual(['default']);
  });

  it('reports `export default` applied to an expression rather than a declaration', () => {
    const io = createMemoryIo().setFile(f('a.ts'), `const a = 1; export default a;`);
    expect(names(io, f('a.ts'))).toEqual(['default']);
  });

  // ES `export *` re-exports every name except `default`, so counting one here would claim a
  // binding the entry point does not have.
  it('does not carry a default export through `export *`', () => {
    const io = createMemoryIo()
      .setFile(f('index.ts'), `export * from './badge';`)
      .setFile(f('badge.ts'), `export default class Badge {}`);
    expect(names(io, f('index.ts'))).toEqual([]);
  });

  it('names every binding of a destructured export', () => {
    const io = createMemoryIo().setFile(
      f('a.ts'),
      `export const { a, b: renamed } = obj;
       export const [c] = arr;`
    );
    expect(names(io, f('a.ts'))).toEqual(['a', 'c', 'renamed']);
  });

  it('names an `export import` alias', () => {
    const io = createMemoryIo().setFile(
      f('a.ts'),
      `import * as ns from './ns';
       export import Alias = ns.Thing;`
    );
    expect(names(io, f('a.ts'))).toEqual(['Alias']);
  });

  // Both node and tsc exhaust the file extensions before falling back to a directory index.
  it('resolves a re-export to a sibling file before a directory index of the same name', () => {
    const io = createMemoryIo()
      .setFile(f('index.ts'), `export * from './thing';`)
      .setFile(f('thing.js'), `export class FromFile {}`)
      .setFile(f('thing/index.ts'), `export class FromDir {}`);
    expect(names(io, f('index.ts'))).toEqual(['FromFile']);
  });

  it('resolves a re-export to a directory index file', () => {
    const io = createMemoryIo()
      .setFile(f('index.ts'), `export * from './feature';`)
      .setFile(f('feature/index.ts'), `export class Feature {}`);
    expect(names(io, f('index.ts'))).toEqual(['Feature']);
  });

  it('under-reports rather than guessing at a bare re-export', () => {
    const io = createMemoryIo().setFile(
      f('index.ts'),
      `export * from '@angular/core';
       export class Own {}`
    );
    expect(names(io, f('index.ts'))).toEqual(['Own']);
  });

  it('terminates on a re-export cycle', () => {
    const io = createMemoryIo()
      .setFile(f('a.ts'), `export * from './b'; export class A {}`)
      .setFile(f('b.ts'), `export * from './a'; export class B {}`);
    expect(names(io, f('a.ts'))).toEqual(['A', 'B']);
  });

  // TypeScript exports neither binding when two `export *` branches carry the same name.
  it('drops a name two star re-exports disagree on', () => {
    const io = createMemoryIo()
      .setFile(f('index.ts'), `export * from './a'; export * from './b';`)
      .setFile(f('a.ts'), `export class Dup {} export class OnlyA {}`)
      .setFile(f('b.ts'), `export class Dup {} export class OnlyB {}`);
    expect(names(io, f('index.ts'))).toEqual(['OnlyA', 'OnlyB']);
  });

  // The same file arriving through two branches is not a disagreement.
  it('keeps a name two star re-exports agree on', () => {
    const io = createMemoryIo()
      .setFile(f('index.ts'), `export * from './a'; export * from './b';`)
      .setFile(f('a.ts'), `export * from './shared';`)
      .setFile(f('b.ts'), `export * from './shared';`)
      .setFile(f('shared.ts'), `export class Shared {}`);
    expect(names(io, f('index.ts'))).toEqual(['Shared']);
  });

  it('returns nothing for a file that cannot be read', () => {
    expect(names(createMemoryIo(), f('missing.ts'))).toEqual([]);
  });
});

describe('createMappingImportResolver', () => {
  // The shape ngtsc produces: the app imports the barrel, the compiler synthesizes a deep
  // relative import to the file that defines a transitively referenced component.
  const lib = (barrel: string) =>
    createMemoryIo()
      .setFile(f('libs/ui/src/index.ts'), barrel)
      .setFile(f('libs/ui/src/ui.module.ts'), `export class UiModule {}`)
      .setFile(f('libs/ui/src/badge.component.ts'), `export class BadgeComponent {}`);

  const MAPPINGS = { [f('libs/ui/src/index.ts')]: '@myorg/ui' };
  const APP = f('apps/host/src/app.component.ts');

  it('rewrites a deep import the barrel republishes', () => {
    const io = lib(`export * from './ui.module'; export * from './badge.component';`);
    const resolve = createMappingImportResolver(MAPPINGS, io);
    expect(resolve(f('libs/ui/src/badge.component'), APP)).toBe('@myorg/ui');
  });

  it('declines a deep import the barrel keeps internal', () => {
    const io = lib(`export * from './ui.module';`);
    const resolve = createMappingImportResolver(MAPPINGS, io);
    expect(resolve(f('libs/ui/src/badge.component'), APP)).toBeNull();
  });

  it('declines when the barrel renames the symbol, which a rewrite would not follow', () => {
    const io = lib(
      `export * from './ui.module';
       export { BadgeComponent as Badge } from './badge.component';`
    );
    const resolve = createMappingImportResolver(MAPPINGS, io);
    expect(resolve(f('libs/ui/src/badge.component'), APP)).toBeNull();
  });

  // tsc erases the import and the re-export that depends on it, so the emitted barrel has no
  // `BadgeComponent` binding at all -- a rewrite would leave `i1.BadgeComponent` undefined.
  it('declines when the barrel re-exports the target through a type-only import', () => {
    const io = lib(
      `export * from './ui.module';
       import type { BadgeComponent } from './badge.component';
       export { BadgeComponent };`
    );
    const resolve = createMappingImportResolver(MAPPINGS, io);
    expect(resolve(f('libs/ui/src/badge.component'), APP)).toBeNull();
  });

  it('declines when a type-only hop sits one re-export above the target', () => {
    const io = createMemoryIo()
      .setFile(f('libs/ui/src/index.ts'), `export * from './mid';`)
      .setFile(
        f('libs/ui/src/mid.ts'),
        `import type { BadgeComponent } from './badge.component';
         export { BadgeComponent };`
      )
      .setFile(f('libs/ui/src/badge.component.ts'), `export class BadgeComponent {}`);
    const resolve = createMappingImportResolver(MAPPINGS, io);
    expect(resolve(f('libs/ui/src/badge.component'), APP)).toBeNull();
  });

  // Two files under one mapping can declare the same name, and a set of names cannot tell them
  // apart. The barrel republishes a's `Config`, so rewriting b onto the mapping would leave
  // `i1.Config` reading a's class -- not duplicated, not undefined, just the wrong binding.
  it('declines when the barrel exports the target’s name from a different file', () => {
    const io = createMemoryIo()
      .setFile(f('libs/ui/src/index.ts'), `export { Config } from './a';`)
      .setFile(f('libs/ui/src/a.ts'), `export class Config {}`)
      .setFile(f('libs/ui/src/b.ts'), `export class Config {}`);
    const resolve = createMappingImportResolver(MAPPINGS, io);
    expect(resolve(f('libs/ui/src/b'), APP)).toBeNull();
  });

  // `export *` publishes neither when two branches disagree on a name, so the entry point does
  // not carry it and the target cannot be reached through the mapping.
  it('declines when two star re-exports make the target’s name ambiguous', () => {
    const io = createMemoryIo()
      .setFile(f('libs/ui/src/index.ts'), `export * from './a'; export * from './b';`)
      .setFile(f('libs/ui/src/a.ts'), `export class Config {}`)
      .setFile(f('libs/ui/src/b.ts'), `export class Config {}`);
    const resolve = createMappingImportResolver(MAPPINGS, io);
    expect(resolve(f('libs/ui/src/b'), APP)).toBeNull();
  });

  // `b` is itself ambiguous on `Config`, and merging its clash up used to replace the one
  // found between `a` and `c` rather than join it, leaving the winning symbol unaccounted for.
  it('declines a name three stars disagree on through a nested ambiguity', () => {
    const io = createMemoryIo()
      .setFile(
        f('libs/ui/src/index.ts'),
        `export * from './a'; export * from './b'; export * from './c';`
      )
      .setFile(f('libs/ui/src/a.ts'), `export class Config {}`)
      .setFile(f('libs/ui/src/b.ts'), `export * from './d'; export * from './e';`)
      .setFile(f('libs/ui/src/d.ts'), `export class Config {}`)
      .setFile(f('libs/ui/src/e.ts'), `export class Config {}`)
      .setFile(f('libs/ui/src/c.ts'), `export class Config {}`);
    const resolve = createMappingImportResolver(MAPPINGS, io);
    expect(resolve(f('libs/ui/src/a'), APP)).toBeNull();
  });

  // Two branches carrying one name from the *same* binding are not ambiguous: ES exports it,
  // and so does tsc.
  it('rewrites when two star branches reach the target through one binding', () => {
    const io = createMemoryIo()
      .setFile(f('libs/ui/src/index.ts'), `export * from './re'; export * from './badge';`)
      .setFile(f('libs/ui/src/re.ts'), `export { Badge } from './badge';`)
      .setFile(f('libs/ui/src/badge.ts'), `export class Badge {}`);
    const resolve = createMappingImportResolver(MAPPINGS, io);
    expect(resolve(f('libs/ui/src/badge'), APP)).toBe('@myorg/ui');
  });

  it('rewrites when both branches are named re-exports of one binding', () => {
    const io = createMemoryIo()
      .setFile(f('libs/ui/src/index.ts'), `export * from './a'; export * from './b';`)
      .setFile(f('libs/ui/src/a.ts'), `export { Badge } from './badge';`)
      .setFile(f('libs/ui/src/b.ts'), `export { Badge } from './badge';`)
      .setFile(f('libs/ui/src/badge.ts'), `export class Badge {}`);
    const resolve = createMappingImportResolver(MAPPINGS, io);
    expect(resolve(f('libs/ui/src/badge'), APP)).toBe('@myorg/ui');
  });

  // An explicit re-export shadows a star carrying the same name, so only one of the two files
  // is actually reachable under it.
  it('credits the name to the explicit re-export rather than the star it shadows', () => {
    const io = createMemoryIo()
      .setFile(f('libs/ui/src/index.ts'), `export * from './a'; export { Thing } from './b';`)
      .setFile(f('libs/ui/src/a.ts'), `export class Thing {}`)
      .setFile(f('libs/ui/src/b.ts'), `export class Thing {}`);
    const resolve = createMappingImportResolver(MAPPINGS, io);
    expect(resolve(f('libs/ui/src/b'), APP)).toBe('@myorg/ui');
    expect(resolve(f('libs/ui/src/a'), APP)).toBeNull();
  });

  // The two spellings have to agree about where a name came from, or a barrel that re-exports
  // through an intermediate file would never match anything.
  it('rewrites when the barrel reaches the target through an intermediate re-export', () => {
    const io = createMemoryIo()
      .setFile(f('libs/ui/src/index.ts'), `export { Deep } from './mid';`)
      .setFile(f('libs/ui/src/mid.ts'), `export * from './deep';`)
      .setFile(f('libs/ui/src/deep.ts'), `export class Deep {}`);
    const resolve = createMappingImportResolver(MAPPINGS, io);
    expect(resolve(f('libs/ui/src/deep'), APP)).toBe('@myorg/ui');
  });

  it('declines when the target re-exports a name from a module it cannot resolve', () => {
    const io = createMemoryIo()
      .setFile(f('libs/ui/src/index.ts'), `export * from './re';`)
      .setFile(f('libs/ui/src/re.ts'), `export { Gone } from './missing'; export class Own {}`);
    const resolve = createMappingImportResolver(MAPPINGS, io);
    expect(resolve(f('libs/ui/src/re'), APP)).toBeNull();
  });

  it('declines when the barrel publishes only some of the target names', () => {
    const io = createMemoryIo()
      .setFile(f('libs/ui/src/index.ts'), `export { A } from './pair';`)
      .setFile(f('libs/ui/src/pair.ts'), `export class A {} export class B {}`);
    const resolve = createMappingImportResolver(MAPPINGS, io);
    expect(resolve(f('libs/ui/src/pair'), APP)).toBeNull();
  });

  // The subset test is `target names ⊆ entry point names`, so a target name this walk fails to
  // see makes the test pass where it should have failed -- the one direction that produces a
  // rewrite onto a specifier the chunk does not export. Each of these declines for that reason.
  it('declines when the target re-exports a bare specifier it cannot enumerate', () => {
    const io = createMemoryIo()
      .setFile(f('libs/ui/src/index.ts'), `export { Own } from './re';`)
      .setFile(f('libs/ui/src/re.ts'), `export * from '@angular/core'; export class Own {}`);
    const resolve = createMappingImportResolver(MAPPINGS, io);
    expect(resolve(f('libs/ui/src/re'), APP)).toBeNull();
  });

  it('declines when the barrel omits a destructured export of the target', () => {
    const io = createMemoryIo()
      .setFile(f('libs/ui/src/index.ts'), `export { A } from './pair';`)
      .setFile(f('libs/ui/src/pair.ts'), `export const { a, b } = obj; export class A {}`);
    const resolve = createMappingImportResolver(MAPPINGS, io);
    expect(resolve(f('libs/ui/src/pair'), APP)).toBeNull();
  });

  it('declines a target using `export =`, which has no name a namespace access could use', () => {
    const io = lib(`export * from './ui.module';`).setFile(
      f('libs/ui/src/legacy.ts'),
      `class Legacy {} export = Legacy;`
    );
    const resolve = createMappingImportResolver(MAPPINGS, io);
    expect(resolve(f('libs/ui/src/legacy'), APP)).toBeNull();
  });

  // A cycle is not an unknown: ES resolves it, so `a` genuinely publishes both A and B, and
  // the barrel republishes both. The previous walk declined here only because it could not
  // enumerate a file it was already inside.
  it('rewrites through a re-export cycle, which resolves to one surface', () => {
    const io = createMemoryIo()
      .setFile(f('libs/ui/src/index.ts'), `export * from './a'; export * from './b';`)
      .setFile(f('libs/ui/src/a.ts'), `export * from './b'; export class A {}`)
      .setFile(f('libs/ui/src/b.ts'), `export * from './a'; export class B {}`);
    const resolve = createMappingImportResolver(MAPPINGS, io);
    expect(resolve(f('libs/ui/src/a'), APP)).toBe('@myorg/ui');
  });

  it('declines a default-only target, which the barrel’s `export *` does not republish', () => {
    const io = createMemoryIo()
      .setFile(f('libs/ui/src/index.ts'), `export * from './badge.component';`)
      .setFile(f('libs/ui/src/badge.component.ts'), `export default class Badge {}`);
    const resolve = createMappingImportResolver(MAPPINGS, io);
    expect(resolve(f('libs/ui/src/badge.component'), APP)).toBeNull();
  });

  it('rewrites the barrel itself when reached by a relative path', () => {
    const io = lib(`export * from './ui.module';`);
    const resolve = createMappingImportResolver(MAPPINGS, io);
    expect(resolve(f('libs/ui/src/index.ts'), APP)).toBe('@myorg/ui');
  });

  // A barrel is free to re-export a package, which this walk cannot enumerate -- its surface
  // goes incomplete. That says nothing about an import of the barrel *itself*: the mapping
  // publishes that exact file under that exact specifier, so there is no property access to
  // preserve and nothing for the surface guard to check.
  describe('a barrel whose own surface cannot be fully read', () => {
    const facade = (barrel: string) =>
      createMemoryIo()
        .setFile(f('libs/ui/src/index.ts'), barrel)
        .setFile(f('libs/ui/src/badge.component.ts'), `export class BadgeComponent {}`);

    it('rewrites an exact entry-point hit despite the bare re-export', () => {
      const io = facade(
        `export * from '@angular/core';
         export * from './badge.component';`
      );
      const resolve = createMappingImportResolver(MAPPINGS, io);
      expect(resolve(f('libs/ui/src/index.ts'), APP)).toBe('@myorg/ui');
    });

    it('rewrites a pure facade barrel, which publishes nothing of its own', () => {
      const io = facade(`export * from '@angular/core';`);
      const resolve = createMappingImportResolver(MAPPINGS, io);
      expect(resolve(f('libs/ui/src/index.ts'), APP)).toBe('@myorg/ui');
    });

    // The exact-hit path skips the surface guard, not the self-import check: a mapped lib
    // relatively importing its own barrel must stay internal, or its bundle imports itself.
    it('still leaves the lib’s own file importing its barrel alone', () => {
      const io = facade(`export * from '@angular/core';`);
      const resolve = createMappingImportResolver(MAPPINGS, io);
      const importer = f('libs/ui/src/badge.component.ts');
      expect(resolve(f('libs/ui/src/index.ts'), importer)).toBeNull();
    });

    // A deep import is a different question and the guard still owns it: the entry point's
    // surface is short, so a name it does not carry must not be rewritten onto the mapping.
    it('still declines a deep import the incomplete barrel does not republish', () => {
      const io = facade(`export * from '@angular/core';`);
      const resolve = createMappingImportResolver(MAPPINGS, io);
      expect(resolve(f('libs/ui/src/badge.component'), APP)).toBeNull();
    });
  });

  it('leaves a mapped lib reaching into itself alone', () => {
    const io = lib(`export * from './ui.module'; export * from './badge.component';`);
    const resolve = createMappingImportResolver(MAPPINGS, io);
    const importer = f('libs/ui/src/ui.module.ts');
    expect(resolve(f('libs/ui/src/badge.component'), importer)).toBeNull();
  });

  it('ignores an import that lands outside every mapping', () => {
    const io = lib(`export * from './badge.component';`).setFile(
      f('apps/host/src/local.ts'),
      `export class Local {}`
    );
    const resolve = createMappingImportResolver(MAPPINGS, io);
    expect(resolve(f('apps/host/src/local'), APP)).toBeNull();
  });

  it('does not let one mapping swallow a sibling sharing its prefix', () => {
    const io = createMemoryIo()
      .setFile(f('libs/foo/src/index.ts'), `export class Foo {}`)
      .setFile(f('libs/foobar/src/thing.ts'), `export class Thing {}`);
    const resolve = createMappingImportResolver({ [f('libs/foo/src/index.ts')]: '@x/foo' }, io);
    expect(resolve(f('libs/foobar/src/thing'), APP)).toBeNull();
  });

  // Mapping dirs are compared past their shared prefix, so the degenerate cases -- one mapping,
  // or mappings with nothing in common -- have to behave like any other.
  describe('mappings sharing little or no prefix', () => {
    it('matches when two mappings share only the filesystem root', () => {
      const io = createMemoryIo()
        .setFile(f('libs/ui/src/index.ts'), `export * from './badge';`)
        .setFile(f('libs/ui/src/badge.ts'), `export class Badge {}`)
        .setFile(path.resolve('/other/pkg/src/index.ts'), `export class Other {}`);
      const resolve = createMappingImportResolver(
        {
          [f('libs/ui/src/index.ts')]: '@myorg/ui',
          [path.resolve('/other/pkg/src/index.ts')]: '@myorg/other',
        },
        io
      );
      expect(resolve(f('libs/ui/src/badge'), APP)).toBe('@myorg/ui');
      expect(resolve(path.resolve('/other/pkg/src/index.ts'), APP)).toBe('@myorg/other');
    });

    it('declines a path that is a prefix of the shared root but under no mapping', () => {
      const io = createMemoryIo()
        .setFile(f('libs/ui/src/index.ts'), `export * from './badge';`)
        .setFile(f('libs/ui/src/badge.ts'), `export class Badge {}`)
        .setFile(f('libs/other.ts'), `export class Other {}`);
      const resolve = createMappingImportResolver(MAPPINGS, io);
      expect(resolve(f('libs/other'), APP)).toBeNull();
    });
  });

  it('prefers the longest matching mapping, so an expanded secondary beats its barrel', () => {
    const io = createMemoryIo()
      .setFile(f('libs/ui/src/index.ts'), `export * from './sub/deep';`)
      .setFile(f('libs/ui/src/sub/index.ts'), `export * from './deep';`)
      .setFile(f('libs/ui/src/sub/deep.ts'), `export class Deep {}`);
    const resolve = createMappingImportResolver(
      {
        [f('libs/ui/src/index.ts')]: '@myorg/ui',
        [f('libs/ui/src/sub/index.ts')]: '@myorg/ui/sub',
      },
      io
    );
    expect(resolve(f('libs/ui/src/sub/deep'), APP)).toBe('@myorg/ui/sub');
  });

  it('declines a side-effect-only target, whose entry point would run more than that file', () => {
    const io = createMemoryIo()
      .setFile(f('libs/ui/src/index.ts'), `export * from './ui.module';`)
      .setFile(f('libs/ui/src/ui.module.ts'), `export class UiModule {}`)
      .setFile(f('libs/ui/src/polyfill.ts'), `globalThis.x = 1;`);
    const resolve = createMappingImportResolver(MAPPINGS, io);
    expect(resolve(f('libs/ui/src/polyfill'), APP)).toBeNull();
  });

  it('declines an import that resolves to no file', () => {
    const io = lib(`export * from './badge.component';`);
    const resolve = createMappingImportResolver(MAPPINGS, io);
    expect(resolve(f('libs/ui/src/nope'), APP)).toBeNull();
  });

  it('validates the file the bundler will resolve, not a directory index beside it', () => {
    const io = createMemoryIo()
      .setFile(f('libs/ui/src/index.ts'), `export { FromFile } from './thing.js';`)
      .setFile(f('libs/ui/src/thing.js'), `export class FromFile {}`)
      .setFile(f('libs/ui/src/thing/index.ts'), `export class FromDir {}`);
    const resolve = createMappingImportResolver(MAPPINGS, io);
    expect(resolve(f('libs/ui/src/thing'), APP)).toBe('@myorg/ui');
  });

  // tsconfig `"@myorg/ui": ["libs/ui/src"]`, which `matchMapping` accepts via `isIndexOf`.
  describe('a mapping key naming a directory rather than a barrel file', () => {
    const DIR_MAPPINGS = { [f('libs/ui/src')]: '@myorg/ui' };

    it('behaves like the equivalent file-form key', () => {
      const io = lib(`export * from './ui.module'; export * from './badge.component';`);
      const resolve = createMappingImportResolver(DIR_MAPPINGS, io);
      expect(resolve(f('libs/ui/src/badge.component'), APP)).toBe('@myorg/ui');
    });

    it('does not reach up into the parent directory', () => {
      const io = lib(`export * from './badge.component';`).setFile(
        f('libs/ui/test-setup.ts'),
        `export class Setup {}`
      );
      const resolve = createMappingImportResolver(DIR_MAPPINGS, io);
      expect(resolve(f('libs/ui/test-setup'), APP)).toBeNull();
    });
  });

  it('ignores a mapping whose entry point does not resolve', () => {
    const io = lib(`export * from './badge.component';`);
    const resolve = createMappingImportResolver({ [f('libs/ui/src/missing.ts')]: '@myorg/ui' }, io);
    expect(resolve(f('libs/ui/src/badge.component'), APP)).toBeNull();
  });

  // A barrel and a hand-written deep entry point share a directory, so the longest-dir sort
  // cannot separate them and declaration order carries no meaning.
  describe('two mappings sharing one directory', () => {
    const io = () =>
      createMemoryIo()
        .setFile(
          f('libs/ui/src/index.ts'),
          `export * from './badge.component'; export * from './models';`
        )
        .setFile(f('libs/ui/src/models.ts'), `export class Model {}`)
        .setFile(f('libs/ui/src/badge.component.ts'), `export class BadgeComponent {}`);

    it('validates a deep import against the entry point that publishes it', () => {
      // Deep entry first, so declaration order alone would pick the one that declines.
      const resolve = createMappingImportResolver(
        {
          [f('libs/ui/src/models.ts')]: '@myorg/ui/models',
          [f('libs/ui/src/index.ts')]: '@myorg/ui',
        },
        io()
      );
      expect(resolve(f('libs/ui/src/badge.component'), APP)).toBe('@myorg/ui');
    });

    it('attributes an entry point to its own specifier, not the barrel republishing it', () => {
      // Barrel first, and it does republish `Model`, so only an exact hit gets this right.
      const resolve = createMappingImportResolver(
        {
          [f('libs/ui/src/index.ts')]: '@myorg/ui',
          [f('libs/ui/src/models.ts')]: '@myorg/ui/models',
        },
        io()
      );
      expect(resolve(f('libs/ui/src/models'), APP)).toBe('@myorg/ui/models');
    });
  });
});

describe('createMappingImportResolver — misuse', () => {
  const APP = f('apps/host/src/app.component.ts');

  // Passing the config from `withNativeFederation` instead of the normalized one is silent
  // otherwise: a wildcard key resolves to no file, so every mapping simply declines.
  it('warns when handed an unexpanded wildcard mapping', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const io = createMemoryIo().setFile(f('libs/ui/src/index.ts'), `export class Ui {}`);

    createMappingImportResolver({ [f('libs/*/src/index.ts')]: '@myorg/*' }, io);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unexpanded wildcard'));
    warn.mockRestore();
  });

  it('says nothing for an expanded set', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const io = createMemoryIo().setFile(f('libs/ui/src/index.ts'), `export class Ui {}`);

    const resolve = createMappingImportResolver({ [f('libs/ui/src/index.ts')]: '@myorg/ui' }, io);
    expect(resolve(f('libs/ui/src/index.ts'), APP)).toBe('@myorg/ui');

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('createMappingImportResolver — path spelling', () => {
  const MAPPINGS = { [f('libs/ui/src/index.ts')]: '@myorg/ui' };
  const APP = f('apps/host/src/app.component.ts');

  // `f()` normalizes, so these build the raw strings a caller could hand over instead.
  const raw = (rel: string) => ROOT + '/' + rel;

  const lib = () =>
    createMemoryIo()
      .setFile(f('libs/ui/src/index.ts'), `export * from './badge.component';`)
      .setFile(f('libs/ui/src/badge.component.ts'), `export class BadgeComponent {}`)
      .setFile(f('libs/ui/src/ui.module.ts'), `export class UiModule {}`);

  it.each([
    ['a .. segment', 'libs/ui/src/sub/../badge.component'],
    ['a . segment', 'libs/ui/src/./badge.component'],
    ['a doubled separator', 'libs/ui/src//badge.component'],
  ])('rewrites an imported path carrying %s', (_label, spelling) => {
    const resolve = createMappingImportResolver(MAPPINGS, lib());
    expect(resolve(raw(spelling), APP)).toBe('@myorg/ui');
  });

  // The dangerous direction: containment and the self-import check are prefix tests, so an
  // importer inside the lib spelled with a detour would escape the check and the lib's own
  // bundle would import itself.
  it('still declines a self-import whose spelling hides the mapping directory', () => {
    const resolve = createMappingImportResolver(MAPPINGS, lib());
    const detour = raw('libs/other/../ui/src/ui.module.ts');
    expect(path.resolve(detour)).toBe(f('libs/ui/src/ui.module.ts'));
    expect(resolve(f('libs/ui/src/badge.component'), detour)).toBeNull();
  });

  it('resolves a mapping key that is not normalized', () => {
    const resolve = createMappingImportResolver(
      { [raw('libs/ui/src/sub/../index.ts')]: '@myorg/ui' },
      lib()
    );
    expect(resolve(f('libs/ui/src/badge.component'), APP)).toBe('@myorg/ui');
  });

  // Normalizing is not `realpath`ing. A bundler that follows symlinks reports the real path
  // already, so this stays the caller's to get right rather than a syscall on every lookup.
  it('does not follow a symlink into a mapped lib', () => {
    const io = lib().setSymlink(f('node_modules/@myorg/ui'), f('libs/ui'));
    const resolve = createMappingImportResolver(MAPPINGS, io);
    expect(resolve(f('node_modules/@myorg/ui/src/badge.component'), APP)).toBeNull();
    expect(resolve(f('libs/ui/src/badge.component'), APP)).toBe('@myorg/ui');
  });
});

describe('createMappingImportResolver — reset', () => {
  const MAPPINGS = { [f('libs/ui/src/index.ts')]: '@myorg/ui' };
  const APP = f('apps/host/src/app.component.ts');
  const BARREL = f('libs/ui/src/index.ts');
  const BADGE = f('libs/ui/src/badge.ts');

  // A barrel that republishes the whole leaf, so the resolver rewrites before anything changes.
  const published = () =>
    createMemoryIo()
      .setFile(BARREL, `export * from './badge';`)
      .setFile(BADGE, `export class BadgeComponent {}`);

  // Counts reads, to tell a cache hit from a re-walk and to catch eager work in reset().
  const countingIo = (io: ReturnType<typeof createMemoryIo>) => {
    let reads = 0;
    const wrapped = new Proxy(io, {
      get(target, key: string) {
        const value = Reflect.get(target, key) as unknown;
        if (key === 'readText' || key === 'isFile' || key === 'isDirectory') {
          return (...args: [string]) => {
            reads++;
            return (value as (p: string) => unknown).apply(target, args);
          };
        }
        return typeof value === 'function' ? (value as () => unknown).bind(target) : value;
      },
    }) as typeof io;
    return { io: wrapped, reads: () => reads };
  };

  it('keeps serving a cached surface until a build boundary', () => {
    const io = published();
    const resolve = createMappingImportResolver(MAPPINGS, io);
    expect(resolve(BADGE, APP)).toBe('@myorg/ui');

    // The barrel stops publishing the leaf, which would decline on a cold resolver.
    io.setFile(BARREL, `export {};`);
    expect(resolve(BADGE, APP)).toBe('@myorg/ui');

    resolve.reset();
    expect(resolve(BADGE, APP)).toBeNull();
  });

  // Dropping only the edited file's own entry would leave the barrel above it wrong; dropping
  // everything is what makes that impossible to get wrong.
  it('drops a barrel whose surface changed through a file below it', () => {
    const MIDDLE = f('libs/ui/src/reexporter.ts');
    const io = createMemoryIo()
      .setFile(BARREL, `export * from './reexporter';`)
      .setFile(MIDDLE, `export * from './badge';`)
      .setFile(BADGE, `export class BadgeComponent {}`);
    const resolve = createMappingImportResolver(MAPPINGS, io);
    expect(resolve(BADGE, APP)).toBe('@myorg/ui');

    io.setFile(MIDDLE, `export class Other {}`);
    resolve.reset();

    expect(resolve(BADGE, APP)).toBeNull();
  });

  it('re-resolves entry points, so a barrel added mid-watch starts matching', () => {
    // The mapping names a directory; until an index exists there is nothing to resolve against.
    const io = createMemoryIo().setFile(BADGE, `export class BadgeComponent {}`);
    const resolve = createMappingImportResolver({ [f('libs/ui/src')]: '@myorg/ui' }, io);
    expect(resolve(BADGE, APP)).toBeNull();

    io.setFile(BARREL, `export * from './badge';`);
    resolve.reset();

    expect(resolve(BADGE, APP)).toBe('@myorg/ui');
  });

  // reset() is called once per build, including builds that never touch a mapping, so the
  // entry-point re-resolution has to wait for a lookup rather than run on the spot.
  it('does no I/O until the next lookup', () => {
    const { io, reads } = countingIo(published());
    const resolve = createMappingImportResolver(MAPPINGS, io);
    expect(resolve(BADGE, APP)).toBe('@myorg/ui');

    const warm = reads();
    resolve.reset();
    expect(reads()).toBe(warm);

    expect(resolve(BADGE, APP)).toBe('@myorg/ui');
    expect(reads()).toBeGreaterThan(warm);
  });

  it('defers even the first entry-point resolution until asked', () => {
    const { io, reads } = countingIo(published());
    createMappingImportResolver(MAPPINGS, io);
    expect(reads()).toBe(0);
  });
});

describe('createMappingImportResolver — node16/nodenext specifiers', () => {
  const APP = f('apps/host/src/app.component.ts');
  const MAPPINGS = { [f('libs/ui/src/index.ts')]: '@myorg/ui' };

  const lib = () =>
    createMemoryIo()
      .setFile(f('libs/ui/src/index.ts'), `export * from './badge.component';`)
      .setFile(f('libs/ui/src/badge.component.ts'), `export class BadgeComponent {}`);

  it('resolves a .js specifier onto its TypeScript source', () => {
    // Under `moduleResolution: node16`/`nodenext` a relative import must carry the emitted
    // extension, so this is the ordinary spelling there — not a mistake to be declined.
    const resolve = createMappingImportResolver(MAPPINGS, lib());
    expect(resolve(f('libs/ui/src/badge.component.js'), APP)).toBe('@myorg/ui');
  });

  it.each([
    ['.mjs', '.mts'],
    ['.cjs', '.cts'],
    ['.jsx', '.tsx'],
  ])('maps %s onto %s', (emitted, source) => {
    // The barrel spells the emitted extension too: `.mts`/`.cts` are reachable only through
    // their output name, so an extensionless `./badge.component` resolves to neither in tsc.
    const barrel = source === '.tsx' ? './badge.component' : './badge.component' + emitted;
    const io = createMemoryIo()
      .setFile(f('libs/ui/src/index.ts'), `export * from '${barrel}';`)
      .setFile(f('libs/ui/src/badge.component' + source), `export class BadgeComponent {}`);
    const resolve = createMappingImportResolver(MAPPINGS, io);
    expect(resolve(f('libs/ui/src/badge.component' + emitted), APP)).toBe('@myorg/ui');
  });

  it('prefers the TypeScript source over a build artefact sitting beside it', () => {
    // A stale `badge.component.js` next to its source is what tsc would skip, and reading the
    // artefact's surface could disagree with what the bundler actually compiles.
    const io = lib().setFile(f('libs/ui/src/badge.component.js'), `export class Stale {}`);
    const resolve = createMappingImportResolver(MAPPINGS, io);
    expect(resolve(f('libs/ui/src/badge.component.js'), APP)).toBe('@myorg/ui');
  });

  it('still resolves a genuine .js file with no TypeScript counterpart', () => {
    const io = createMemoryIo()
      .setFile(f('libs/ui/src/index.ts'), `export * from './helper.js';`)
      .setFile(f('libs/ui/src/helper.js'), `export class Helper {}`);
    const resolve = createMappingImportResolver(MAPPINGS, io);
    expect(resolve(f('libs/ui/src/helper.js'), APP)).toBe('@myorg/ui');
  });
});

// Regressions for the hole the hand-rolled walk had: it treated any readable file as an ES
// module and never checked for parse errors, so a target whose exports it could not actually
// read reported as complete -- the one direction that rewrites onto a name nobody publishes.
describe('createMappingImportResolver — targets whose exports cannot be read', () => {
  const MAPPINGS = { [f('libs/ui/src/index.ts')]: '@myorg/ui' };
  const APP = f('apps/host/src/app.component.ts');

  it('declines a target star-exporting a CommonJS file', () => {
    const io = createMemoryIo()
      .setFile(f('libs/ui/src/index.ts'), `export { Own } from './re';`)
      .setFile(f('libs/ui/src/re.ts'), `export * from './legacy.js'; export class Own {}`)
      // Not an ES module, so its `helper` is invisible to the walk but live at runtime.
      .setFile(f('libs/ui/src/legacy.js'), `module.exports.helper = function () {};`);
    const resolve = createMappingImportResolver(MAPPINGS, io);
    expect(resolve(f('libs/ui/src/re'), APP)).toBeNull();
  });

  it('declines a target it cannot parse, whose later exports are silently dropped', () => {
    const io = createMemoryIo()
      .setFile(f('libs/ui/src/index.ts'), `export { Own } from './broken';`)
      .setFile(f('libs/ui/src/broken.ts'), `export class Own {} @@@ !!! export class Hidden {}`);
    const resolve = createMappingImportResolver(MAPPINGS, io);
    expect(resolve(f('libs/ui/src/broken'), APP)).toBeNull();
  });
});

// The decline that is worth telling the user about: the barrel was readable and simply does not
// carry the file. Every other decline means "unknown", which says nothing about their library.
describe('createMappingImportResolver — the unpublished-target warning', () => {
  const MAPPINGS = { [f('libs/ui/src/index.ts')]: '@myorg/ui' };
  const APP = f('apps/host/src/app.component.ts');

  // A module-level spy: an assertion that fails mid-test would skip a per-test restore, and the
  // next spy would then stack on top of it and inherit its call count.
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // The canonical declining shape: an NgModule barrel that publishes only the module.
  const hidden = () =>
    createMemoryIo()
      .setFile(f('libs/ui/src/index.ts'), `export * from './ui.module';`)
      .setFile(f('libs/ui/src/ui.module.ts'), `export class UiModule {}`)
      .setFile(f('libs/ui/src/badge.component.ts'), `export class BadgeComponent {}`);

  it('names the unpublished file, the barrel, and the specifier', () => {
    const resolve = createMappingImportResolver(MAPPINGS, hidden());

    expect(resolve(f('libs/ui/src/badge.component'), APP)).toBeNull();

    expect(warn).toHaveBeenCalledTimes(1);
    const message = warn.mock.calls[0]![0] as string;
    // The file is the unit the fix is spelled in — `export * from './badge.component'`.
    expect(message).toContain(f('libs/ui/src/badge.component.ts'));
    expect(message).toContain(f('libs/ui/src/index.ts'));
    expect(message).toContain('@myorg/ui');
  });

  it('names the missing exports when the barrel reaches the file but drops names', () => {
    const io = createMemoryIo()
      .setFile(f('libs/ui/src/index.ts'), `export { A } from './pair';`)
      .setFile(f('libs/ui/src/pair.ts'), `export class A {} export class B {}`);
    const resolve = createMappingImportResolver(MAPPINGS, io);

    expect(resolve(f('libs/ui/src/pair'), APP)).toBeNull();

    expect(warn).toHaveBeenCalledTimes(1);
    const message = warn.mock.calls[0]![0] as string;
    expect(message).toContain('B');
    expect(message).not.toContain('A,');
    expect(message).toContain(f('libs/ui/src/pair.ts'));
  });

  it('warns once per target across a rebuild\u2019s worth of lookups, and again after reset', () => {
    const resolve = createMappingImportResolver(MAPPINGS, hidden());

    // esbuild re-resolves the whole module graph, so one deep import arrives many times.
    for (let i = 0; i < 10; i++) resolve(f('libs/ui/src/badge.component'), APP);
    expect(warn).toHaveBeenCalledTimes(1);

    resolve.reset();
    resolve(f('libs/ui/src/badge.component'), APP);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('stays silent when the barrel is the unreadable half, which is not the user\u2019s to fix', () => {
    // The barrel re-exports a package, so its surface is a lower bound rather than a refusal.
    const io = createMemoryIo()
      .setFile(f('libs/ui/src/index.ts'), `export * from '@angular/core';`)
      .setFile(f('libs/ui/src/badge.component.ts'), `export class BadgeComponent {}`);
    const resolve = createMappingImportResolver(MAPPINGS, io);

    expect(resolve(f('libs/ui/src/badge.component'), APP)).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it('stays silent when the target is the unreadable half', () => {
    const io = createMemoryIo()
      .setFile(f('libs/ui/src/index.ts'), `export { Own } from './re';`)
      .setFile(f('libs/ui/src/re.ts'), `export * from '@angular/core'; export class Own {}`);
    const resolve = createMappingImportResolver(MAPPINGS, io);

    expect(resolve(f('libs/ui/src/re'), APP)).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it('stays silent on a self-import, which is not a decline about publication', () => {
    const resolve = createMappingImportResolver(MAPPINGS, hidden());

    expect(resolve(f('libs/ui/src/badge.component'), f('libs/ui/src/other.ts'))).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it('stays silent when the rewrite succeeds', () => {
    const io = createMemoryIo()
      .setFile(f('libs/ui/src/index.ts'), `export * from './badge.component';`)
      .setFile(f('libs/ui/src/badge.component.ts'), `export class BadgeComponent {}`);
    const resolve = createMappingImportResolver(MAPPINGS, io);

    expect(resolve(f('libs/ui/src/badge.component'), APP)).toBe('@myorg/ui');
    expect(warn).not.toHaveBeenCalled();
  });

  // The advice would name an export already in the barrel, leaving the reader nowhere to go.
  it('stays silent when two star branches reach the target through one binding', () => {
    const io = createMemoryIo()
      .setFile(
        f('libs/ui/src/index.ts'),
        `export * from './ui.module';
         export * from './re';
         export * from './badge.component';`
      )
      .setFile(f('libs/ui/src/ui.module.ts'), `export class UiModule {}`)
      .setFile(f('libs/ui/src/re.ts'), `export { BadgeComponent } from './badge.component';`)
      .setFile(f('libs/ui/src/badge.component.ts'), `export class BadgeComponent {}`);
    const resolve = createMappingImportResolver(MAPPINGS, io);

    expect(resolve(f('libs/ui/src/badge.component'), APP)).toBe('@myorg/ui');
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('createMappingImportResolver — robustness of the module graph', () => {
  const MAPPINGS = {
    [f('libs/ui/src/index.ts')]: '@myorg/ui',
    [f('libs/ui/testing/index.ts')]: '@myorg/ui/testing',
  };
  const APP = f('apps/host/src/app.component.ts');

  it('declines rather than throwing when a file vanishes between the check and the read', () => {
    const io = createMemoryIo()
      .setFile(f('libs/ui/src/index.ts'), `export * from './badge.component';`)
      .setFile(f('libs/ui/src/badge.component.ts'), `export class BadgeComponent {}`);

    // A watch rebuild racing a delete: `isFile` said yes, the read then fails. Escaping here
    // would fail the whole build from inside the bundler's resolve hook.
    const read = io.readText.bind(io);
    io.readText = (p: string) => {
      if (p.endsWith('badge.component.ts')) throw new Error('ENOENT: vanished');
      return read(p);
    };

    const resolve = createMappingImportResolver(MAPPINGS, io);
    expect(() => resolve(f('libs/ui/src/badge.component'), APP)).not.toThrow();
    expect(resolve(f('libs/ui/src/badge.component'), APP)).toBeNull();
  });

  it('resolves a barrel that re-exports a sibling mapping through its published alias', () => {
    // The ordinary shape in a workspace with secondary entry points. Without the mappings
    // supplied as `paths` the alias does not resolve, and the surface silently goes incomplete.
    const io = createMemoryIo()
      .setFile(
        f('libs/ui/src/index.ts'),
        `export * from './badge.component';\nexport * from '@myorg/ui/testing';`
      )
      .setFile(f('libs/ui/src/badge.component.ts'), `export class BadgeComponent {}`)
      .setFile(f('libs/ui/testing/index.ts'), `export class Harness {}`);
    const resolve = createMappingImportResolver(MAPPINGS, io);

    expect(resolve(f('libs/ui/src/badge.component'), APP)).toBe('@myorg/ui');
  });

  it('still declines on an alias that is not itself a mapping', () => {
    const io = createMemoryIo()
      .setFile(f('libs/ui/src/index.ts'), `export { Own } from './re';`)
      .setFile(f('libs/ui/src/re.ts'), `export * from '@other/unknown'; export class Own {}`);
    const resolve = createMappingImportResolver(MAPPINGS, io);

    expect(resolve(f('libs/ui/src/re'), APP)).toBeNull();
  });

  it('reads an entry point surface once per build, and again after reset', () => {
    const io = createMemoryIo()
      .setFile(f('libs/ui/src/index.ts'), `export * from './badge.component';`)
      .setFile(f('libs/ui/src/badge.component.ts'), `export class BadgeComponent {}`)
      .setFile(f('libs/ui/testing/index.ts'), `export class Harness {}`);

    const reads = new Map<string, number>();
    const read = io.readText.bind(io);
    io.readText = (p: string) => {
      reads.set(p, (reads.get(p) ?? 0) + 1);
      return read(p);
    };

    const resolve = createMappingImportResolver(MAPPINGS, io);
    for (let i = 0; i < 25; i++) resolve(f('libs/ui/src/badge.component'), APP);

    // The program reads each file once; the memo is what stops the star walk repeating.
    const barrelReads = reads.get(f('libs/ui/src/index.ts')) ?? 0;
    expect(barrelReads).toBeLessThanOrEqual(2);

    resolve.reset();
    resolve(f('libs/ui/src/badge.component'), APP);
    expect(reads.get(f('libs/ui/src/index.ts'))).toBeGreaterThan(barrelReads);
  });
});

describe('createMappingImportResolver — a mis-cased mapping key', () => {
  const APP = f('apps/host/src/app.component.ts');

  // A case-insensitive filesystem resolves a mis-cased tsconfig `paths` value happily, so the
  // mapping survives to here spelled differently from everything the bundler reports. The
  // containment prefix then fails on every lookup and the resolver declines silently — no
  // rewrite, no warning, no signal at all.
  const miscased = () =>
    createMemoryIo()
      // Both spellings exist, as they do on such a filesystem.
      .setFile(f('libs/ui/src/index.ts'), `export * from './badge.component';`)
      .setFile(f('libs/ui/src/badge.component.ts'), `export class BadgeComponent {}`)
      .setFile(f('libs/UI/src/index.ts'), `export * from './badge.component';`)
      .setFile(f('libs/UI/src/badge.component.ts'), `export class BadgeComponent {}`)
      .setDiskCase(f('libs/UI/src/index.ts'), f('libs/ui/src/index.ts'));

  it('still rewrites a path the bundler reports in the spelling on disk', () => {
    const resolve = createMappingImportResolver(
      { [f('libs/UI/src/index.ts')]: '@myorg/ui' },
      miscased()
    );
    expect(resolve(f('libs/ui/src/badge.component'), APP)).toBe('@myorg/ui');
  });

  // Only the exact-entry-point branch can rewrite a barrel whose surface cannot be enumerated,
  // and that branch is the module's one raw string compare.
  it('still rewrites an exact entry-point hit it cannot enumerate', () => {
    const io = createMemoryIo()
      .setFile(f('libs/ui/src/index.ts'), `export * from '@angular/core';`)
      .setFile(f('libs/UI/src/index.ts'), `export * from '@angular/core';`)
      .setDiskCase(f('libs/UI/src/index.ts'), f('libs/ui/src/index.ts'));
    const resolve = createMappingImportResolver({ [f('libs/UI/src/index.ts')]: '@myorg/ui' }, io);
    expect(resolve(f('libs/ui/src/index.ts'), APP)).toBe('@myorg/ui');
  });

  it('leaves a genuinely different directory alone', () => {
    // toDiskCase only corrects a case-only difference, so a symlinked or otherwise relocated
    // path is still handed back untouched — that stays the caller's to resolve.
    const io = createMemoryIo()
      .setFile(f('libs/ui/src/index.ts'), `export * from './badge.component';`)
      .setFile(f('libs/ui/src/badge.component.ts'), `export class BadgeComponent {}`)
      .setSymlink(f('links/ui'), f('libs/ui'));
    const resolve = createMappingImportResolver({ [f('links/ui/src/index.ts')]: '@myorg/ui' }, io);
    expect(resolve(f('libs/ui/src/badge.component'), APP)).toBeNull();
  });
});
