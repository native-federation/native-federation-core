import * as ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';
import { toChunkImport } from '../domain/core/chunk.js';

export function rewriteChunkImports(filePath: string) {
  const sourceCode = fs.readFileSync(filePath, 'utf-8');

  const sourceFile = ts.createSourceFile(
    path.basename(filePath),
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

  const result = printer.printFile(updatedSourceFile as ts.SourceFile);

  fs.writeFileSync(filePath, result, 'utf-8');
}

export function isSourceFile(fileName: string): boolean {
  return !!fileName.match(/.(m|c)?js$/);
}
