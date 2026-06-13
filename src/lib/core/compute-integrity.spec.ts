import { describe, expect, it } from 'vitest';
import * as crypto from 'crypto';
import { computeIntegrityMapCore } from './compute-integrity.js';
import { createMemoryIo } from '../utils/io/__test-helpers__/memory-io.js';

const sri = (data: string, algorithm: 'sha384' = 'sha384') =>
  `${algorithm}-${crypto.createHash(algorithm).update(data).digest('base64')}`;

describe('computeIntegrityMapCore', () => {
  it('computes an SRI hash keyed by basename for present files', () => {
    const io = createMemoryIo().setFile('/cache/react.js', 'REACT');
    const map = computeIntegrityMapCore(io, ['react.js'], '/cache');
    expect(map).toEqual({ 'react.js': sri('REACT') });
  });

  it('skips sourcemap files', () => {
    const io = createMemoryIo()
      .setFile('/cache/react.js', 'REACT')
      .setFile('/cache/react.js.map', '{}');
    const map = computeIntegrityMapCore(io, ['react.js', 'react.js.map'], '/cache');
    expect(Object.keys(map)).toEqual(['react.js']);
  });

  it('skips files that do not exist on disk', () => {
    const io = createMemoryIo().setFile('/cache/react.js', 'REACT');
    const map = computeIntegrityMapCore(io, ['react.js', 'missing.js'], '/cache');
    expect(map).toEqual({ 'react.js': sri('REACT') });
  });

  it('treats entries as absolute paths when baseDir is empty', () => {
    const io = createMemoryIo().setFile('/abs/dir/react.js', 'REACT');
    const map = computeIntegrityMapCore(io, ['/abs/dir/react.js'], '');
    expect(map).toEqual({ 'react.js': sri('REACT') });
  });

  it('returns an empty map when given no files', () => {
    expect(computeIntegrityMapCore(createMemoryIo(), [], '/cache')).toEqual({});
  });
});
