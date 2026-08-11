import * as path from 'path';
import { toPosix } from './path-patterns.js';
import type { FileReaderPort } from '../domain/utils/io-port.contract.js';

/**
 * Re-spells `p` the way disk spells it, but only when the two differ by case alone.
 *
 * Every absolute path that gets string-compared later descends from a root supplied by
 * the invoking tool, and on Windows two tools can report the same root with different
 * drive-letter case. Correcting it at the root keeps the comparison sites unchanged.
 */
export function toDiskCase(io: FileReaderPort, p: string): string {
  const real = io.realpathNative(p);
  if (real === p || !differsOnlyByCase(real, p)) return p;
  return path.normalize(real);
}

// realpath also resolves symlinks; accepting only a case-only difference keeps this a pure
// case correction, so link-based setups (pnpm, npm link, preserveSymlinks) are unaffected.
// Separator style and trailing slashes are stripped first, otherwise 'c:/x' and 'C:\x' never
// compare equal and the guard rejects a correction it should accept.
function differsOnlyByCase(a: string, b: string): boolean {
  const strip = (s: string) => toPosix(s).replace(/\/+$/, '').toLowerCase();
  return strip(a) === strip(b);
}
