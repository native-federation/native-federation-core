import { describe, expect, it, vi } from 'vitest';
import * as path from 'path';
import { synthesizeCjsNamedExportsEntry } from './synthesize-cjs-exports.js';
import { createMemoryIo } from '../../utils/io/__test-helpers__/memory-io.js';
import { logger } from '../../utils/logger.js';
import type { PackageInfo } from '../../domain/utils/package-json.contract.js';

const CACHE = '/cache';

const pkg = (over: Partial<PackageInfo>): PackageInfo => ({
  packageName: 'x',
  entryPoint: '/n/x/index.js',
  version: '1.0.0',
  esm: false,
  ...over,
});

describe('synthesizeCjsNamedExportsEntry', () => {
  it('writes a synthetic entry re-exporting a CJS package’s named exports (dayjs case)', () => {
    const io = createMemoryIo().setFile(
      '/n/dayjs/dayjs.min.js',
      '!function(t,e){module.exports=e()}(this,function(){})'
    );
    const mod = { isDayjs: () => {}, extend: () => {} };

    const out = synthesizeCjsNamedExportsEntry(
      io,
      () => mod,
      pkg({ packageName: 'dayjs', entryPoint: '/n/dayjs/dayjs.min.js', esm: false }),
      CACHE,
      'dayjs.abc123.js'
    );

    expect(out).toBe(path.join(CACHE, '.nf-cjs-entries', 'dayjs.abc123.js'));
    const written = io.readText(out!);
    expect(written).toContain('import _nfDefault from "/n/dayjs/dayjs.min.js";');
    expect(written).toContain('as isDayjs');
    expect(written).toContain('as extend');
  });

  it('skips an ESM package by metadata — never evaluates it (rxjs case)', () => {
    const io = createMemoryIo().setFile(
      '/n/rxjs/dist/esm/index.js',
      `export { Observable } from './internal/Observable';`
    );
    const evaluate = vi.fn(() => ({}));

    const out = synthesizeCjsNamedExportsEntry(
      io,
      evaluate,
      pkg({ packageName: 'rxjs', entryPoint: '/n/rxjs/dist/esm/index.js', esm: true }),
      CACHE,
      'rxjs'
    );

    expect(out).toBeNull();
    expect(evaluate).not.toHaveBeenCalled();
  });

  it('falls back to default-only (null) and warns when a CJS require() genuinely fails', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const io = createMemoryIo().setFile(
      '/n/broken/index.js',
      '!function(){module.exports={}}()'
    );

    const out = synthesizeCjsNamedExportsEntry(
      io,
      () => {
        throw new ReferenceError('window is not defined');
      },
      pkg({ packageName: 'broken', entryPoint: '/n/broken/index.js', esm: false }),
      CACHE,
      'broken'
    );

    expect(out).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('falls back silently (null, no warning) when require() fails because the file was ESM', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const io = createMemoryIo().setFile('/n/esm-cjs/index.cjs', 'module.exports={}');

    const out = synthesizeCjsNamedExportsEntry(
      io,
      () => {
        const err = new Error('require of ES module') as Error & { code: string };
        err.code = 'ERR_REQUIRE_ESM';
        throw err;
      },
      pkg({ packageName: 'esm-cjs', entryPoint: '/n/esm-cjs/index.cjs', esm: false }),
      CACHE,
      'esm_cjs'
    );

    expect(out).toBeNull();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('returns null (leaves the original entry) when there are no names to wrap', () => {
    const io = createMemoryIo().setFile('/n/x/index.js', 'module.exports=function(){}');
    const out = synthesizeCjsNamedExportsEntry(io, () => () => {}, pkg({}), CACHE, 'x');
    expect(out).toBeNull();
  });
});
