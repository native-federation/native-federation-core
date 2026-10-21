import { initSync, parse } from 'es-module-lexer';
import type { FileReaderPort } from '../domain/utils/io-port.contract.js';

function isBare(specifier: string): boolean {
  if (specifier.startsWith('.') || specifier.startsWith('/')) return false;
  return !/^[a-z][a-z0-9+.-]*:/i.test(specifier) || specifier.startsWith('node:');
}

// Matches the way esbuild reads `external`: a name covers its subpaths, and one '*' is a wildcard.
export function matchesExternal(specifier: string, externals: readonly string[]): boolean {
  return externals.some(external => {
    const star = external.indexOf('*');
    if (star === -1) return specifier === external || specifier.startsWith(external + '/');
    const prefix = external.slice(0, star);
    const suffix = external.slice(star + 1);
    return (
      specifier.length >= prefix.length + suffix.length &&
      specifier.startsWith(prefix) &&
      specifier.endsWith(suffix)
    );
  });
}

// Static and dynamic imports alike; throws on a file the lexer cannot parse.
export function readBareImports(io: FileReaderPort, filePath: string, fileName: string): string[] {
  initSync();
  // es-module-lexer finds no import or export directly after a BOM.
  const [imports] = parse(io.readText(filePath).replace(/^\uFEFF/, ''), fileName);
  return imports
    .filter(imp => imp.d !== -2 && imp.n !== undefined && isBare(imp.n))
    .map(imp => imp.n!);
}
