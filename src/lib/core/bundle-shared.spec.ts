import { describe, expect, it } from 'vitest';
import * as crypto from 'crypto';
import { calcHashCore } from './bundle-shared.js';
import { createMemoryIo } from '../utils/io/__test-helpers__/memory-io.js';

const io = createMemoryIo();

const expectedHash = (base: string) =>
  crypto
    .createHash('sha256')
    .update(base)
    .digest('base64')
    .replace(/\//g, '_')
    .replace(/\+/g, '-')
    .replace(/=/g, '')
    .substring(0, 10);

describe('calcHashCore', () => {
  it('produces a 10-char base64url-safe hash', () => {
    const hash = calcHashCore(io, 'react_18.0.0_state');
    expect(hash).toHaveLength(10);
    expect(hash).toMatch(/^[A-Za-z0-9_-]{10}$/);
  });

  it('matches a hand-computed sha256 base64url hash', () => {
    expect(calcHashCore(io, 'react_18.0.0_state')).toBe(expectedHash('react_18.0.0_state'));
  });

  it('is deterministic for the same input', () => {
    expect(calcHashCore(io, 'a')).toBe(calcHashCore(io, 'a'));
  });

  it('differs for different inputs', () => {
    expect(calcHashCore(io, 'a')).not.toBe(calcHashCore(io, 'b'));
  });
});
