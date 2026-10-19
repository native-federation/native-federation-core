import { describe, expect, it } from 'vitest';
import { isScript } from './script-file.js';

describe('isScript', () => {
  it.each(['a.js', 'a.mjs', 'a.cjs', 'chunk-ABC123.js', 'dir/a.js'])('accepts %s', name => {
    expect(isScript(name)).toBe(true);
  });

  // 'a.xjs' and 'a.ejs' (an esbuild file-loader asset) matched the old unescaped dot; 'a.JS'
  // stays out because bundlers only ever write lowercase extensions.
  it.each(['a.ts', 'a.css', 'a.json', 'a.js.map', 'a.xjs', 'a.ejs', 'xjs', 'a.JS', 'a.jsx'])(
    'rejects %s',
    name => {
      expect(isScript(name)).toBe(false);
    }
  );
});
