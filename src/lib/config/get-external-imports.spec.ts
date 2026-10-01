import { describe, expect, it } from 'vitest';
import * as path from 'path';
import { getExternalImportsCore } from './get-external-imports.js';
import { createMemoryIo } from '../utils/io/__test-helpers__/memory-io.js';

const ROOT = path.resolve('/proj');
const f = (rel: string) => path.join(ROOT, rel);

describe('getExternalImportsCore', () => {
  it('collects bare external specifiers from import and export declarations', () => {
    const io = createMemoryIo().setFile(
      f('entry.ts'),
      `import { a } from 'react';
       export { b } from '@angular/core';`
    );
    expect(getExternalImportsCore(io, f('entry.ts')).sort()).toEqual(['@angular/core', 'react']);
  });

  it('detects CommonJS require() specifiers', () => {
    const io = createMemoryIo().setFile(f('entry.ts'), `const x = require('lodash');`);
    expect(getExternalImportsCore(io, f('entry.ts'))).toEqual(['lodash']);
  });

  it('follows relative imports and does not treat them as external', () => {
    const io = createMemoryIo()
      .setFile(f('entry.ts'), `import './local';`)
      .setFile(f('local.ts'), `import 'external-dep';`);
    expect(getExternalImportsCore(io, f('entry.ts'))).toEqual(['external-dep']);
  });

  it('resolves a relative import to a directory index file', () => {
    const io = createMemoryIo()
      .setFile(f('entry.ts'), `import './feature';`)
      .setFile(f('feature/index.ts'), `import 'feat-dep';`);
    expect(getExternalImportsCore(io, f('entry.ts'))).toEqual(['feat-dep']);
  });

  it('does not revisit files (handles cycles)', () => {
    const io = createMemoryIo()
      .setFile(f('a.ts'), `import './b'; import 'dep-a';`)
      .setFile(f('b.ts'), `import './a'; import 'dep-b';`);
    expect(getExternalImportsCore(io, f('a.ts')).sort()).toEqual(['dep-a', 'dep-b']);
  });

  it('returns nothing when the entry file does not exist', () => {
    expect(getExternalImportsCore(createMemoryIo(), f('missing.ts'))).toEqual([]);
  });
});
