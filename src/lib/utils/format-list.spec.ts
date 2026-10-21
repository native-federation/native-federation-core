import { describe, expect, it } from 'vitest';
import { formatList } from './format-list.js';

describe('formatList', () => {
  it('quotes every item when they fit', () => {
    expect(formatList(['a', 'b'], 2)).toBe("'a', 'b'");
  });

  it('counts the items past the limit', () => {
    expect(formatList(['a', 'b', 'c', 'd'], 2)).toBe("'a', 'b' and 2 more");
  });
});
