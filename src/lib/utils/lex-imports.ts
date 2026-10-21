import { initSync, parse, type ImportSpecifier } from 'es-module-lexer';

export function lexImports(sourceCode: string, fileName: string): readonly ImportSpecifier[] {
  initSync();
  // es-module-lexer misses the statement directly after a BOM; a space keeps every offset in place.
  const [imports] = parse(sourceCode.replace(/^\uFEFF/, ' '), fileName);
  return imports;
}
