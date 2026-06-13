import { describe, expect, it } from 'vitest';
import { AbortedError } from './errors.js';

describe('AbortedError', () => {
  it('sets the name and preserves the message', () => {
    const err = new AbortedError('stopped');
    expect(err.name).toBe('AbortedError');
    expect(err.message).toBe('stopped');
  });

  it('is an instance of both AbortedError and Error', () => {
    const err = new AbortedError('x');
    expect(err).toBeInstanceOf(AbortedError);
    expect(err).toBeInstanceOf(Error);
  });
});
