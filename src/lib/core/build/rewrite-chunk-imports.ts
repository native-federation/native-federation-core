import * as ts from 'typescript';
import * as path from 'path';
import type { FileReaderPort, FileWriterPort } from '../../domain/utils/io-port.contract.js';
import { nodeIo } from '../../utils/io/node-io-adapter.js';
import { toChunkImport } from '../../domain/core/chunk.js';

export function rewriteChunkImports(filePath: string): void {
  rewriteChunkImportsCore(nodeIo, filePath);
}

export function rewriteChunkImportsCore(
  io: FileReaderPort & FileWriterPort,
  filePath: string
): void {
  io.writeText(filePath, transformChunkImports(io.readText(filePath), path.basename(filePath)));
}

export function transformChunkImports(sourceCode: string, fileName: string): string {
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceCode,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.JS
  );

  const printer = ts.createPrinter();

  function visit(node: ts.Node): ts.Node {
    // import ... from '...'
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const moduleSpecifier = node.moduleSpecifier;
      if (moduleSpecifier && ts.isStringLiteral(moduleSpecifier)) {
        const text = moduleSpecifier.text;
        if (text.startsWith('./')) {
          const newModuleSpecifier = ts.factory.createStringLiteral(toChunkImport(text));

          if (ts.isImportDeclaration(node)) {
            return ts.factory.updateImportDeclaration(
              node,
              node.modifiers,
              node.importClause,
              newModuleSpecifier,
              node.assertClause
            );
          } else {
            return ts.factory.updateExportDeclaration(
              node,
              node.modifiers,
              node.isTypeOnly,
              node.exportClause,
              newModuleSpecifier,
              node.assertClause
            );
          }
        }
      }
    }

    // import('./...')
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [arg] = node.arguments;
      if (arg && ts.isStringLiteral(arg)) {
        const text = arg.text;
        if (text.startsWith('./')) {
          const newArg = ts.factory.createStringLiteral(toChunkImport(text));
          return ts.factory.updateCallExpression(node, node.expression, node.typeArguments, [
            newArg,
          ]);
        }
      }
    }

    return ts.visitEachChild(node, visit, undefined);
  }

  const transformed = ts.transform(sourceFile, [_ => node => ts.visitNode(node as any, visit)]);
  const updatedSourceFile = transformed.transformed[0];

  return printer.printFile(updatedSourceFile as ts.SourceFile);
}

export function isSourceFile(fileName: string): boolean {
  return !!fileName.match(/.(m|c)?js$/);
}
