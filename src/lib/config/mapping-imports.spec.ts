import { describe, expect, it } from 'vitest';
import * as path from 'path';
import { createMappingImportResolver, mappingExportNames } from './mapping-imports.js';
import { createMemoryIo } from '../utils/io/__test-helpers__/memory-io.js';

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
    const io = createMemoryIo().setFile(
      f('a.ts'),
      `export interface Props {}
       export type Alias = string;
       export type { Gone } from './other';
       export { type AlsoGone, Kept } from './other';`
    );
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

  it('declines when the barrel publishes only some of the target names', () => {
    const io = createMemoryIo()
      .setFile(f('libs/ui/src/index.ts'), `export { A } from './pair';`)
      .setFile(f('libs/ui/src/pair.ts'), `export class A {} export class B {}`);
    const resolve = createMappingImportResolver(MAPPINGS, io);
    expect(resolve(f('libs/ui/src/pair'), APP)).toBeNull();
  });

  it('rewrites the barrel itself when reached by a relative path', () => {
    const io = lib(`export * from './ui.module';`);
    const resolve = createMappingImportResolver(MAPPINGS, io);
    expect(resolve(f('libs/ui/src/index.ts'), APP)).toBe('@myorg/ui');
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
});
