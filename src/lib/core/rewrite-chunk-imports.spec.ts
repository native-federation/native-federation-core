import { describe, expect, it } from 'vitest';
import { isSourceFile, rewriteChunkImportsCore } from './rewrite-chunk-imports.js';
import { createMemoryIo } from '../utils/io/__test-helpers__/memory-io.js';

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

  it('leaves bare/external specifiers untouched', () => {
    const out = rewrite(`import 'react';`);
    expect(out).toContain("'react'");
    expect(out).not.toContain('@nf-internal');
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
