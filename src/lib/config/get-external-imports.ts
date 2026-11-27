import * as path from 'path';
import * as ts from 'typescript';
import type { FileReaderPort } from '../domain/utils/io-port.contract.js';
import { resolveModuleFile } from '../utils/module-file.js';

export function getExternalImportsCore(io: FileReaderPort, entryFilePath: string): string[] {
  const visited = new Set<string>();
  const externals = new Set<string>();

  function isExternal(specifier: string) {
    return !specifier.startsWith('.') && !path.isAbsolute(specifier);
  }

  function handleSpecifier(spec: string, fromFile: string) {
    if (isExternal(spec)) {
      externals.add(spec);
      return;
    }
    const resolvedPath = resolveModuleFile(io, path.resolve(path.dirname(fromFile), spec));
    if (resolvedPath) visit(resolvedPath);
  }

  function visit(filePath: string) {
    const absPath = path.resolve(filePath);
    if (visited.has(absPath)) return;
    visited.add(absPath);

    const resolvedFile: string | null = resolveModuleFile(io, absPath);
    if (!resolvedFile) return;
    const fromFile: string = resolvedFile;

    const source = io.readText(fromFile);
    const sourceFile = ts.createSourceFile(fromFile, source, ts.ScriptTarget.Latest, true);

    function walk(node: ts.Node) {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        const moduleSpecifier = node.moduleSpecifier;
        if (moduleSpecifier && ts.isStringLiteral(moduleSpecifier)) {
          handleSpecifier(moduleSpecifier.text, fromFile);
        }
      }

      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.escapedText === 'require' &&
        node.arguments.length === 1 &&
        ts.isStringLiteral(node.arguments[0]!)
      ) {
        handleSpecifier(node.arguments[0].text, fromFile);
      }

      // An external covers its subpaths, so a lazy import of one stays bare, and pruning it
      // leaves an import the import map cannot resolve (core#168).
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments[0] &&
        ts.isStringLiteralLike(node.arguments[0])
      ) {
        handleSpecifier(node.arguments[0].text, fromFile);
      }

      ts.forEachChild(node, walk);
    }

    ts.forEachChild(sourceFile, walk);
  }

  visit(entryFilePath);

  return Array.from(externals);
}
