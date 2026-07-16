import { describe, expect, it } from 'vitest';
import {
  isIdentifierName,
  planCjsWrap,
  buildSyntheticCjsEntry,
  isEsmInteropError,
} from './cjs-named-exports.js';

describe('isIdentifierName', () => {
  it('accepts valid identifiers and rejects the rest', () => {
    for (const ok of ['isDayjs', '_x', '$', 'a1']) expect(isIdentifierName(ok)).toBe(true);
    for (const bad of ['1a', 'a-b', 'a.b', '', 'a b']) expect(isIdentifierName(bad)).toBe(false);
  });
});

describe('planCjsWrap', () => {
  it('wraps a CJS object, dropping default/__esModule and non-identifier keys', () => {
    const plan = planCjsWrap({ isDayjs: () => {}, extend: () => {}, default: 1, '0bad': 1 });
    expect(plan.wrap).toBe(true);
    expect(plan.keys.sort()).toEqual(['extend', 'isDayjs']);
  });

  it('does not wrap ES-module namespaces', () => {
    const ns = { foo: 1 } as Record<PropertyKey, unknown>;
    ns[Symbol.toStringTag] = 'Module';
    expect(planCjsWrap(ns).wrap).toBe(false);
  });

  it('does not wrap __esModule interop objects', () => {
    expect(planCjsWrap({ __esModule: true, foo: 1 }).wrap).toBe(false);
  });

  it('does not wrap primitives, null, or objects with no extra keys', () => {
    expect(planCjsWrap(null).wrap).toBe(false);
    expect(planCjsWrap(42).wrap).toBe(false);
    expect(planCjsWrap({ default: 1 }).wrap).toBe(false);
  });
});

describe('buildSyntheticCjsEntry', () => {
  it('re-exports default plus each name via an alias clause', () => {
    const out = buildSyntheticCjsEntry('/n/dayjs/dayjs.min.js', ['isDayjs', 'extend']);
    expect(out).toContain(`import _nfDefault from "/n/dayjs/dayjs.min.js";`);
    expect(out).toContain(`export default _nfDefault;`);
    expect(out).toContain(`const _nf0 = _nfDefault["isDayjs"];`);
    expect(out).toContain(`export { _nf0 as isDayjs, _nf1 as extend };`);
  });

  it('emits default-only when there are no names', () => {
    const out = buildSyntheticCjsEntry('/n/x/index.js', []);
    expect(out).toContain('export default _nfDefault;');
    expect(out).not.toContain('export {');
  });
});

describe('isEsmInteropError', () => {
  it('recognises ESM require errors', () => {
    expect(isEsmInteropError({ code: 'ERR_REQUIRE_ESM' })).toBe(true);
    expect(isEsmInteropError({ code: 'ERR_REQUIRE_ASYNC_MODULE' })).toBe(true);
    expect(isEsmInteropError(new SyntaxError('Unexpected token \'export\''))).toBe(true);
  });

  it('does not treat genuine failures as ESM interop', () => {
    expect(isEsmInteropError(new ReferenceError('window is not defined'))).toBe(false);
    expect(isEsmInteropError({ code: 'ERR_MODULE_NOT_FOUND' })).toBe(false);
  });
});
