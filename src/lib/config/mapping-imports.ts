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

/**
 * `complete` is false when the walk met an export form it cannot read. Which direction that is
 * safe in depends on the side: a short set of entry point names only fails a subset test, but a
 * short set of *target* names passes one it should have failed, so a caller that needs every
 * name a file publishes has to decline on it rather than treat it as the whole surface.
 */
interface ExportSurface {
  names: Set<string>;
  complete: boolean;
}

function hasModifier(statement: ts.Statement, kind: ts.SyntaxKind): boolean {
  return (
    ts.canHaveModifiers(statement) && (ts.getModifiers(statement) ?? []).some(m => m.kind === kind)
  );
}

function addBindingName(name: ts.BindingName, names: Set<string>): void {
  if (ts.isIdentifier(name)) {
    names.add(name.text);
    return;
  }

  for (const element of name.elements) {
    if (ts.isBindingElement(element)) addBindingName(element.name, names);
  }
}

/** Types are erased, so only value declarations are named here. */
function addDeclaredNames(statement: ts.Statement, surface: ExportSurface): void {
  // Carries no modifiers, so it has to be read before the export check below.
  if (ts.isExportAssignment(statement)) {
    if (statement.isExportEquals) surface.complete = false;
    else surface.names.add('default');
    return;
  }

  if (!hasModifier(statement, ts.SyntaxKind.ExportKeyword)) return;

  if (hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) {
    surface.names.add('default');
    return;
  }

  if (ts.isVariableStatement(statement)) {
    for (const declaration of statement.declarationList.declarations) {
      addBindingName(declaration.name, surface.names);
    }
    return;
  }

  if (ts.isImportEqualsDeclaration(statement)) {
    surface.names.add(statement.name.text);
    return;
  }

  if (
    ts.isClassDeclaration(statement) ||
    ts.isFunctionDeclaration(statement) ||
    ts.isEnumDeclaration(statement) ||
    ts.isModuleDeclaration(statement)
  ) {
    if (statement.name && ts.isIdentifier(statement.name)) surface.names.add(statement.name.text);
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

/** Memoized per file: a barrel graph re-reads the same leaves through several branches. */
function createExportWalker(io: FileReaderPort): (file: string) => ExportSurface {
  const cache = new Map<string, ExportSurface>();
  const inProgress = new Set<string>();

  const walk = (file: string): ExportSurface => {
    const cached = cache.get(file);
    if (cached) return cached;

    // A re-export cycle. The names on it are real, but enumerating them from here means
    // re-entering this walk, so report the surface as unknown rather than as short.
    if (inProgress.has(file)) return { names: new Set(), complete: false };

    const surface: ExportSurface = { names: new Set(), complete: true };
    inProgress.add(file);

    const source = parse(io, file);
    if (!source) surface.complete = false;

    for (const statement of source?.statements ?? []) {
      if (!ts.isExportDeclaration(statement)) {
        addDeclaredNames(statement, surface);
        continue;
      }

      if (statement.isTypeOnly) continue;

      if (!statement.exportClause) {
        const target = resolveReexport(io, statement.moduleSpecifier, file);
        if (!target) {
          surface.complete = false;
          continue;
        }

        const reexported = walk(target);
        // `export *` does not re-export the default binding.
        for (const name of reexported.names) if (name !== 'default') surface.names.add(name);
        if (!reexported.complete) surface.complete = false;
        continue;
      }

      if (ts.isNamespaceExport(statement.exportClause)) {
        surface.names.add(statement.exportClause.name.text);
        continue;
      }

      for (const element of statement.exportClause.elements) {
        if (!element.isTypeOnly) surface.names.add(element.name.text);
      }
    }

    inProgress.delete(file);
    cache.set(file, surface);
    return surface;
  };

  return walk;
}

/**
 * The names an importer of `filePath` can reach at runtime. Names rather than files because a
 * rewrite swaps the module specifier and keeps the property access, so `export { A as B }`
 * leaves the file reachable while `ns.A` is undefined.
 *
 * A name this walk cannot read -- behind a bare re-export, an `export =`, a missing file -- is
 * left out, so the set is a lower bound. Callers that cannot tolerate that go through
 * `createMappingImportResolver`, which tracks the difference.
 */
export function mappingExportNames(filePath: string, io: FileReaderPort = nodeIo): Set<string> {
  return createExportWalker(io)(filePath).names;
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
 *
 * Expects `sharedMappings` after wildcard expansion, which is what `normalizeOptions` leaves on
 * the config -- keys are compared literally, so an unexpanded wildcard key matches nothing here.
 * Export surfaces are cached for the resolver's lifetime, so construct one per build rather than
 * holding it across watch rebuilds.
 */
export function createMappingImportResolver(
  sharedMappings: PathToImport,
  io: FileReaderPort = nodeIo
): MappingImportResolver {
  // Longest first, so a `resolveGlob`-expanded secondary wins over the barrel above it.
  const mappings = Object.entries(sharedMappings)
    .map(([entryPoint, importName]) => ({ dir: path.dirname(entryPoint), entryPoint, importName }))
    .sort((a, b) => b.dir.length - a.dir.length);

  const exportsOf = createExportWalker(io);

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
    if (!reachable.complete || reachable.names.size === 0) return null;

    // Only the target's completeness is checked: a gap in the entry point's surface can just
    // fail the test below, which is already the outcome this declines to.
    const surface = exportsOf(mapping.entryPoint);
    for (const name of reachable.names) {
      if (!surface.names.has(name)) return null;
    }

    return mapping.importName;
  };
}
