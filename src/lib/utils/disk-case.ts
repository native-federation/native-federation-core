import * as path from 'path';
import { toPosix } from './path-patterns.js';
import type { FileReaderPort } from '../domain/utils/io-port.contract.js';
import { nodeIo } from './io/node-io-adapter.js';

/**
 * Every absolute path that gets string-compared later descends from a root supplied by the
 * invoking tool, and on Windows two tools can report one root with different drive-letter case.
 * Correcting it at the root keeps the comparison sites unchanged.
 */
export function toDiskCaseCore(io: FileReaderPort, p: string): string {
  const real = io.realpathNative(p);
  if (real === p || !differsOnlyByCase(real, p)) return p;
  return path.normalize(real);
}

// Corrects case only: keeps symlinked spellings, and returns a missing path unchanged.
export function toDiskCase(p: string): string {
  return toDiskCaseCore(nodeIo, p);
}

// realpath also resolves symlinks, so anything broader than a case difference would move pnpm,
// `npm link` and `preserveSymlinks` off the path they were handed. Separator style and trailing
// slashes are stripped first, or 'c:/x' and 'C:\x' never compare equal.
function differsOnlyByCase(a: string, b: string): boolean {
  const strip = (s: string) => toPosix(s).replace(/\/+$/, '').toLowerCase();
  return strip(a) === strip(b);
}
