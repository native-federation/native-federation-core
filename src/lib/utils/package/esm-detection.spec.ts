import { describe, expect, it } from 'vitest';
import { isESMExport, classifyByExtension, hasEsmSyntax, isCjsCandidate } from './esm-detection.js';

describe('isESMExport', () => {
  it('classifies known ESM conditions as true', () => {
    for (const e of ['import', 'module-sync', 'module', 'esm', 'es2020', 'es2022']) {
      expect(isESMExport(e)).toBe(true);
    }
  });

  it('classifies known CJS conditions as false', () => {
    for (const e of ['require', 'cjs', 'commonjs']) {
      expect(isESMExport(e)).toBe(false);
    }
  });

  it('returns undefined for ambiguous conditions', () => {
    for (const e of ['default', 'types', 'node', 'browser']) {
      expect(isESMExport(e)).toBeUndefined();
    }
  });
});

describe('classifyByExtension', () => {
  it('maps extensions to formats', () => {
    expect(classifyByExtension('/a/index.mjs')).toBe('esm');
    expect(classifyByExtension('/a/index.cjs')).toBe('cjs');
    expect(classifyByExtension('/a/index.js')).toBe('unknown');
  });

  it('treats unknown/extensionless entries as esm (never blindly required)', () => {
    expect(classifyByExtension('/a/index')).toBe('esm');
    expect(classifyByExtension('/a/index.json')).toBe('esm');
  });
});

describe('hasEsmSyntax', () => {
  it('detects top-level export/import statements', () => {
    expect(hasEsmSyntax(`export { Observable } from './internal/Observable';`)).toBe(true);
    expect(hasEsmSyntax(`export default foo;`)).toBe(true);
    expect(hasEsmSyntax(`import x from 'y';`)).toBe(true);
    expect(hasEsmSyntax(`export{a};import"b"`)).toBe(true);
  });

  it('does not flag CommonJS/UMD or dynamic import as ESM', () => {
    expect(hasEsmSyntax(`!function(t,e){module.exports=e()}(this,function(){return {}})`)).toBe(
      false
    );
    expect(hasEsmSyntax(`const m = await import('x');`)).toBe(false);
  });
});

describe('isCjsCandidate', () => {
  it('excludes ESM by metadata even when the entry is a plain .js (rxjs case)', () => {
    expect(
      isCjsCandidate({
        esm: true,
        entryPoint: '/n/rxjs/dist/esm/index.js',
        readSource: () => `export { Observable } from './internal/Observable';`,
      })
    ).toBe(false);
  });

  it('includes a UMD .js with no ESM metadata (dayjs case)', () => {
    expect(
      isCjsCandidate({
        esm: false,
        entryPoint: '/n/dayjs/dayjs.min.js',
        readSource: () => `!function(t,e){module.exports=e()}(this,function(){})`,
      })
    ).toBe(true);
  });

  it('excludes ambiguous .js when its source is ESM, even without metadata', () => {
    expect(
      isCjsCandidate({
        entryPoint: '/n/pkg/index.js',
        readSource: () => `export const x = 1;`,
      })
    ).toBe(false);
  });

  it('excludes ambiguous .js under a type:module package', () => {
    expect(isCjsCandidate({ entryPoint: '/n/pkg/index.js', packageType: 'module' })).toBe(false);
  });

  it('classifies by extension: .mjs → excluded, .cjs → included', () => {
    expect(isCjsCandidate({ entryPoint: '/n/pkg/index.mjs' })).toBe(false);
    expect(isCjsCandidate({ entryPoint: '/n/pkg/index.cjs' })).toBe(true);
  });
});
