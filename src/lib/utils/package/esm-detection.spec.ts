import { describe, expect, it } from 'vitest';
import { isESMExport } from './esm-detection.js';

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
