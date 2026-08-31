import * as path from 'path';
import * as ts from 'typescript';
import type { FileReaderPort } from '../domain/utils/io-port.contract.js';
import type { PathToImport } from '../domain/utils/mapped-path.contract.js';
import { nodeIo } from '../utils/io/node-io-adapter.js';
import { isUnderDir } from '../utils/path-patterns.js';

const RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

/** Wider than `get-external-imports.ts`'s copy, which predates the tsx/mts cases. */
function resolveModuleFile(io: FileReaderPort, candidate: string): string | null {
  if (io.isFile(candidate)) return candidate;

  for (const ext of RESOLVE_EXTENSIONS) {
    if (io.isFile(candidate + ext)) return candidate + ext;

    const index = path.join(candidate, 'index' + ext);
    if (io.isFile(index)) return index;
  }

  return null;
}

function parse(io: FileReaderPort, file: string): ts.SourceFile | null {
  try {
    return ts.createSourceFile(file, io.readText(file), ts.ScriptTarget.Latest, false);
  } catch {
    return null;
  }
}

function hasModifier(statement: ts.Statement, kind: ts.SyntaxKind): boolean {
  return (
    ts.canHaveModifiers(statement) && (ts.getModifiers(statement) ?? []).some(m => m.kind === kind)
  );
}

/** Types are erased, so only value declarations are named here. */
function addDeclaredNames(statement: ts.Statement, names: Set<string>): void {
  if (!hasModifier(statement, ts.SyntaxKind.ExportKeyword)) return;

  if (hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) {
    names.add('default');
    return;
  }

  if (ts.isVariableStatement(statement)) {
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text);
    }
    return;
  }

  if (
    ts.isClassDeclaration(statement) ||
    ts.isFunctionDeclaration(statement) ||
    ts.isEnumDeclaration(statement) ||
    ts.isModuleDeclaration(statement)
  ) {
    if (statement.name && ts.isIdentifier(statement.name)) names.add(statement.name.text);
  }
}

function resolveReexport(
  io: FileReaderPort,
  specifier: ts.Expression | undefined,
  fromFile: string
): string | null {
  if (!specifier || !ts.isStringLiteral(specifier) || !specifier.text.startsWith('.')) return null;
  return resolveModuleFile(io, path.resolve(path.dirname(fromFile), specifier.text));
}

/**
 * The names an importer of `filePath` can reach at runtime. Names rather than files because a
 * rewrite swaps the module specifier and keeps the property access, so `export { A as B }`
 * leaves the file reachable while `ns.A` is undefined.
 *
 * Under-reports by design: a re-export that cannot be resolved here -- a bare specifier, a
 * missing file -- is left out, so a caller declines to rewrite rather than betting on a name.
 */
export function mappingExportNames(filePath: string, io: FileReaderPort = nodeIo): Set<string> {
  const names = new Set<string>();
  const visited = new Set<string>();

  const visit = (file: string): void => {
    if (visited.has(file)) return;
    visited.add(file);

    const source = parse(io, file);
    if (!source) return;

    for (const statement of source.statements) {
      if (!ts.isExportDeclaration(statement)) {
        addDeclaredNames(statement, names);
        continue;
      }

      if (statement.isTypeOnly) continue;

      if (!statement.exportClause) {
        const target = resolveReexport(io, statement.moduleSpecifier, file);
        if (target) visit(target);
        continue;
      }

      if (ts.isNamespaceExport(statement.exportClause)) {
        names.add(statement.exportClause.name.text);
        continue;
      }

      for (const element of statement.exportClause.elements) {
        if (!element.isTypeOnly) names.add(element.name.text);
      }
    }
  };

  visit(filePath);
  return names;
}

/**
 * Given a relative import and the file that wrote it, the specifier to rewrite it onto, or
 * `null` to leave it alone.
 */
export type MappingImportResolver = (importedFile: string, importerFile: string) => string | null;

/**
 * A compiler that has the mapped lib's source in its program emits relative paths into it
 * rather than the specifier the mapping is published under (ngtsc does this for any reference
 * it synthesizes). Those bypass a bundler's `external`, which matches the unresolved specifier,
 * and the lib ends up bundled twice. This decides when such an import can be pointed back at
 * the mapping instead; adapters keep only the bundler hook.
 */
export function createMappingImportResolver(
  sharedMappings: PathToImport,
  io: FileReaderPort = nodeIo
): MappingImportResolver {
  // Longest first, so a `resolveGlob`-expanded secondary wins over the barrel above it.
  const mappings = Object.entries(sharedMappings)
    .map(([entryPoint, importName]) => ({ dir: path.dirname(entryPoint), entryPoint, importName }))
    .sort((a, b) => b.dir.length - a.dir.length);

  const cache = new Map<string, Set<string>>();
  const exportsOf = (file: string): Set<string> => {
    let names = cache.get(file);
    if (!names) {
      names = mappingExportNames(file, io);
      cache.set(file, names);
    }
    return names;
  };

  return (importedFile, importerFile) => {
    const mapping = mappings.find(m => isUnderDir(importedFile, m.dir));
    if (!mapping) return null;

    // A mapped lib reaching into itself stays internal, or its bundle would import itself.
    if (isUnderDir(importerFile, mapping.dir)) return null;

    const target = resolveModuleFile(io, importedFile);
    if (!target) return null;

    // The rewrite keeps the property access the compiler emitted, and which name that is
    // cannot be known here, so every name the target publishes has to survive the trip
    // through the entry point. A target that exports nothing is imported for its side
    // effects; the entry point runs more than that file, so leave it alone.
    const reachable = exportsOf(target);
    if (reachable.size === 0) return null;

    const surface = exportsOf(mapping.entryPoint);
    for (const name of reachable) {
      if (!surface.has(name)) return null;
    }

    return mapping.importName;
  };
}
