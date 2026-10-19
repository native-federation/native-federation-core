import type { FileReaderPort } from '../domain/utils/io-port.contract.js';
import { lexImports } from './lex-imports.js';

function isBare(specifier: string): boolean {
  if (specifier.startsWith('.') || specifier.startsWith('/')) return false;
  return !/^[a-z][a-z0-9+.-]*:/i.test(specifier) || specifier.startsWith('node:');
}

// Static and dynamic imports alike; throws on a file the lexer cannot parse.
export function readBareImports(io: FileReaderPort, filePath: string, fileName: string): string[] {
  return lexImports(io.readText(filePath), fileName)
    .filter(imp => imp.d !== -2 && imp.n !== undefined && isBare(imp.n))
    .map(imp => imp.n!);
}
