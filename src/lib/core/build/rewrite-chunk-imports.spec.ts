import { decode, encode } from '@jridgewell/sourcemap-codec';
import { describe, expect, it } from 'vitest';
import { isSourceFile, rewriteChunkImportsCore } from './rewrite-chunk-imports.js';
import { createMemoryIo } from '../../utils/io/__test-helpers__/memory-io.js';

const rewrite = (source: string): string => {
  const io = createMemoryIo().setFile('/chunk.js', source);
  rewriteChunkImportsCore(io, '/chunk.js');
  return io.readText('/chunk.js');
};

describe('rewriteChunkImportsCore', () => {
  it('rewrites relative static import specifiers to the chunk prefix', () => {
    expect(rewrite(`import { a } from './dep.js';`)).toContain('@nf-internal/dep');
  });

  it('rewrites relative export-from specifiers', () => {
    expect(rewrite(`export { a } from './dep.js';`)).toContain('@nf-internal/dep');
  });

  it('rewrites dynamic import() specifiers', () => {
    expect(rewrite(`const m = import('./dep.js');`)).toContain('@nf-internal/dep');
  });

  it('rewrites side-effect imports', () => {
    expect(rewrite(`import './dep.js';`)).toBe(`import '@nf-internal/dep';`);
  });

  it('leaves bare/external specifiers untouched', () => {
    const out = rewrite(`import 'react';`);
    expect(out).toContain("'react'");
    expect(out).not.toContain('@nf-internal');
  });

  it('changes nothing but the specifiers', () => {
    const source = `import{a as b}from"./dep.js";const  x =   b;\n\n// kept as is\nexport{x}\n`;
    expect(rewrite(source)).toBe(source.replace('./dep.js', '@nf-internal/dep'));
  });

  it('does not write a file without chunk imports', () => {
    const io = createMemoryIo().setFile('/chunk.js', `export const a = 1;`);
    const writes: string[] = [];
    const original = io.writeText.bind(io);
    io.writeText = (p, data) => {
      writes.push(p);
      original(p, data);
    };
    rewriteChunkImportsCore(io, '/chunk.js');
    expect(writes).toEqual([]);
  });

  it('shifts the map columns after an edit on the same line and leaves other lines alone', () => {
    const source = `import{a}from"./dep.js";import"./side.js";function foo(){return a}\nfoo();\n`;
    const fooColumn = source.indexOf('function foo');
    const returnColumn = source.indexOf('return a');
    const map = {
      version: 3,
      sources: ['src/a.ts'],
      names: ['foo'],
      mappings: encode([
        [
          [0, 0, 0, 0],
          [fooColumn, 0, 10, 0, 0],
          [returnColumn, 0, 11, 2],
        ],
        [[0, 0, 20, 0]],
      ]),
    };
    const io = createMemoryIo()
      .setFile('/chunk.js', source)
      .setFile('/chunk.js.map', JSON.stringify(map));

    rewriteChunkImportsCore(io, '/chunk.js');

    const rewritten = io.readText('/chunk.js');
    const shifted = JSON.parse(io.readText('/chunk.js.map'));
    const [line1, line2] = decode(shifted.mappings);

    expect(line1[0]).toEqual([0, 0, 0, 0]);
    expect(line1[1]).toEqual([rewritten.indexOf('function foo'), 0, 10, 0, 0]);
    expect(line1[2]).toEqual([rewritten.indexOf('return a'), 0, 11, 2]);
    expect(line2).toEqual([[0, 0, 20, 0]]);
    expect(shifted.sources).toEqual(map.sources);
    expect(shifted.names).toEqual(map.names);
  });
});

describe('isSourceFile', () => {
  it('matches js/mjs/cjs files', () => {
    expect(isSourceFile('a.js')).toBe(true);
    expect(isSourceFile('a.mjs')).toBe(true);
    expect(isSourceFile('a.cjs')).toBe(true);
  });

  it('rejects other extensions', () => {
    expect(isSourceFile('a.ts')).toBe(false);
    expect(isSourceFile('a.css')).toBe(false);
  });
});
