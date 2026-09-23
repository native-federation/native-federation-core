import * as path from 'path';
import * as ts from 'typescript';
import type { FileReaderPort } from '../domain/utils/io-port.contract.js';
import type { PathToImport } from '../domain/utils/mapped-path.contract.js';
import { nodeIo } from '../utils/io/node-io-adapter.js';
import { isUnderDir, toPosix } from '../utils/path-patterns.js';
import { toDiskCase } from '../utils/disk-case.js';
import { logger } from '../utils/logger.js';

// The permissive superset of what a mapped lib can spell -- extensionless specifiers, directory
// indexes, node16's `./x.js` naming `x.ts` -- and it needs no tsconfig.
const BASE_OPTIONS: ts.CompilerOptions = {
  allowJs: true,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  target: ts.ScriptTarget.Latest,
  // Without this a .tsx file resolves but is dropped from the program: file inclusion filters
  // on the supported extensions, which only carry .tsx once `jsx` is set.
  jsx: ts.JsxEmit.Preserve,
  noLib: true,
  skipLibCheck: true,
};

/** Value exports only, keyed by the name an importer spells, resolved past re-export chains. */
type Surface = Map<string, ts.Symbol>;

/**
 * `complete` false leaves the surface a lower bound: disqualifying for a target, whose names must
 * all be accounted for, not for an entry point, which only has to cover them. `ambiguous` holds
 * names two stars carry from different bindings, which ES exports as neither.
 */
interface StarExportAudit {
  complete: boolean;
  ambiguous: Map<string, Set<ts.Symbol>>;
}

function auditStarExports(
  program: ts.Program,
  checker: ts.TypeChecker,
  file: string,
  seen: Set<string>
): StarExportAudit {
  const audit: StarExportAudit = { complete: true, ambiguous: new Map() };
  if (seen.has(file)) return audit;
  seen.add(file);

  const source = program.getSourceFile(file);
  if (!source) return { complete: false, ambiguous: audit.ambiguous };

  const clash = (name: string, ...symbols: ts.Symbol[]) => {
    const set = audit.ambiguous.get(name) ?? new Set<ts.Symbol>();
    for (const symbol of symbols) set.add(symbol);
    audit.ambiguous.set(name, set);
  };

  const fromStars = new Map<string, ts.Symbol>();
  for (const statement of source.statements) {
    if (!ts.isExportDeclaration(statement) || statement.isTypeOnly) continue;
    if (!statement.moduleSpecifier) continue;

    const module = checker.getSymbolAtLocation(statement.moduleSpecifier);
    if (!module) {
      audit.complete = false;
      continue;
    }

    // `export * as ns from` publishes one namespace object, not the target's own bindings.
    if (statement.exportClause) continue;

    for (const exported of checker.getExportsOfModule(module)) {
      const earlier = fromStars.get(exported.name);
      if (earlier && bindingOf(checker, earlier) !== bindingOf(checker, exported)) {
        clash(exported.name, earlier, exported);
      }
      fromStars.set(exported.name, exported);
    }

    const target = module.declarations?.find(ts.isSourceFile);
    if (!target) continue;
    const nested = auditStarExports(program, checker, target.fileName, seen);
    audit.complete &&= nested.complete;
    for (const [name, clashing] of nested.ambiguous) clash(name, ...clashing);
  }

  return audit;
}

// The flag sits on the specifier or on the clause one or two levels above it, and erases the
// whole chain -- so the binding at the end of the chain cannot be asked whether it survived.
const isTypeOnlyAlias = (s: ts.Symbol): boolean =>
  !!s.declarations?.some(d =>
    [d, d.parent, d.parent?.parent].some(
      n => (n as { isTypeOnly?: boolean } | undefined)?.isTypeOnly
    )
  );

function bindingOf(checker: ts.TypeChecker, s: ts.Symbol): ts.Symbol | null {
  const seen = new Set<ts.Symbol>();
  let current = s;
  while (current.flags & ts.SymbolFlags.Alias && !seen.has(current)) {
    if (isTypeOnlyAlias(current)) return null;
    seen.add(current);
    const next = checker.getImmediateAliasedSymbol(current);
    if (!next) return checker.getAliasedSymbol(current);
    current = next;
  }
  return current;
}

// `paths` carries the mappings, so a barrel re-exporting a sibling through its published alias
// resolves rather than leaving the surface short.
function createModuleGraph(io: FileReaderPort, paths: ts.MapLike<string[]>) {
  const options: ts.CompilerOptions = { ...BASE_OPTIONS, paths };
  let roots: string[] = [];
  let program: ts.Program | null;
  const surfaces = new Map<string, Surface | null>();

  // The contract lets `readText` throw, and an escaping error fails the bundler's build.
  const readText = (file: string): string | undefined => {
    try {
      return io.isFile(file) ? io.readText(file) : undefined;
    } catch {
      return undefined;
    }
  };

  const caseSensitive = ts.sys?.useCaseSensitiveFileNames ?? true;

  const host: ts.CompilerHost = {
    getSourceFile: file => {
      const text = readText(file);
      return text === undefined
        ? undefined
        : ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    },
    writeFile: () => {},
    getCanonicalFileName: file => (caseSensitive ? file : file.toLowerCase()),
    getNewLine: () => '\n',
    getCurrentDirectory: () => '/',
    getDefaultLibFileName: () => 'lib.d.ts',
    fileExists: file => io.isFile(file),
    readFile: readText,
    directoryExists: dir => io.isDirectory(dir),
    getDirectories: dir => io.readDir(dir).filter(e => io.isDirectory(path.join(dir, e))),
    realpath: file => io.realpath(file),
    useCaseSensitiveFileNames: () => caseSensitive,
  };

  const surfaceOf = (
    program: ts.Program,
    file: string,
    requireComplete: boolean
  ): Surface | null => {
    const source = program.getSourceFile(file);
    if (!source) return null;

    // A file TypeScript could not parse in full would under-report its exports.
    if (program.getSyntacticDiagnostics(source).length > 0) return null;

    const checker = program.getTypeChecker();
    const audit = auditStarExports(program, checker, file, new Set());
    if (requireComplete && !audit.complete) return null;

    const moduleSymbol = checker.getSymbolAtLocation(source);
    if (!moduleSymbol) return null;

    const surface: Surface = new Map();
    for (const exported of checker.getExportsOfModule(moduleSymbol)) {
      // Only where the clash actually won: an explicit export of the same name shadows it.
      if (audit.ambiguous.get(exported.name)?.has(exported)) continue;
      const binding = bindingOf(checker, exported);
      // Types are erased, so a rewrite carrying one would resolve to undefined at runtime.
      if (binding && binding.flags & ts.SymbolFlags.Value) surface.set(exported.name, binding);
    }
    return surface;
  };

  const currentProgram = (): ts.Program => (program ??= ts.createProgram(roots, options, host));

  return {
    resolveFile(rawPath: string): string | null {
      const absolute = path.resolve(rawPath);
      // `resolveModuleName` takes a specifier, not a path, so the last segment is re-spelled
      // relative to its own directory. Always relative, hence BASE_OPTIONS over `options`.
      const from = path.join(path.dirname(absolute), '__nf_resolve__.ts');
      const specifier = './' + path.basename(absolute);
      return (
        ts.resolveModuleName(specifier, from, BASE_OPTIONS, host).resolvedModule
          ?.resolvedFileName ?? null
      );
    },

    useRoots(entryPoints: string[]): void {
      roots = entryPoints;
      program = null;
      surfaces.clear();
    },

    reaches(file: string): boolean {
      return !!currentProgram().getSourceFile(file);
    },

    // Symbols compare by identity only within one program, so the memo dies with it.
    surface(file: string, requireComplete: boolean): Surface | null {
      const key = (requireComplete ? 'C' : 'P') + file;
      const memo = surfaces.get(key);
      if (memo !== undefined) return memo;

      const value = surfaceOf(currentProgram(), file, requireComplete);
      surfaces.set(key, value);
      return value;
    },

    reset(): void {
      roots = [];
      program = null;
      surfaces.clear();
    },
  };
}

export function mappingExportNames(filePath: string, io: FileReaderPort = nodeIo): Set<string> {
  const graph = createModuleGraph(io, {});
  graph.useRoots([filePath]);
  return new Set(graph.surface(filePath, false)?.keys() ?? []);
}

/** The specifier to rewrite the import onto, or `null` to leave it alone. */
export interface MappingImportResolver {
  (importedFile: string, importerFile: string): string | null;

  /** Call where a build starts: a plugin outlives a rebuild, so its program would go stale. */
  reset(): void;
}

/**
 * Is a relative import landing inside a mapped lib expressible through that mapping's entry
 * point? Adapters keep the bundler hook; see PR #133 for why this decides it rather than them.
 *
 * `sharedMappings` must be post-`normalizeOptions`, expanded *and* pruned: an unexpanded key
 * warns, an unpruned one cannot be detected and rewrites onto an unpublished specifier. Paths
 * are normalized but not `realpath`ed, so a caller behind a symlink must pass the real path.
 *
 * App builds only: where the mappings are themselves the entry points every call is a
 * self-import, so nothing rewrites and the program is never built.
 */
export function createMappingImportResolver(
  sharedMappings: PathToImport,
  io: FileReaderPort = nodeIo
): MappingImportResolver {
  const aliases: ts.MapLike<string[]> = {};
  for (const [mappedPath, importName] of Object.entries(sharedMappings)) {
    (aliases[importName] ??= []).push(mappedPath);
  }
  const graph = createModuleGraph(io, aliases);

  const unexpanded = Object.keys(sharedMappings).filter(key => key.includes('*'));
  if (unexpanded.length > 0) {
    logger.warn(
      `Mapping resolver got ${unexpanded.length} unexpanded wildcard mapping(s), which cannot ` +
        `match anything: ${unexpanded.slice(0, 3).join(', ')}. Pass the 'sharedMappings' that ` +
        `'normalizeFederationOptions' leaves on the config, which has them expanded.`
    );
  }

  // A key may name a directory rather than a barrel file, so it resolves like an import would.
  // Longest dir first, so a `resolveGlob`-expanded secondary wins over the barrel above it.
  const resolveMappings = () => {
    const resolved = Object.entries(sharedMappings)
      .flatMap(([key, importName]) => {
        const resolvedKey = graph.resolveFile(key);
        if (!resolvedKey) return [];
        // A mis-cased key resolves anyway on a case-insensitive fs, then fails every prefix
        // test against the spelling the bundler reports.
        // `toDiskCase` ends in `path.normalize`, which is backslash-separated on Windows,
        // while the target compared against it below is always posix.
        const entryPoint = toPosix(toDiskCase(io, resolvedKey));
        const dir = path.dirname(entryPoint);
        return [{ dir, dirPosix: toPosix(dir).replace(/\/+$/, ''), entryPoint, importName }];
      })
      .sort((a, b) => b.dir.length - a.dir.length);

    // Every mapping dir shares the workspace root, which whole-path compares re-walk per import.
    let root = resolved[0]?.dirPosix ?? '';
    for (const m of resolved) {
      let i = 0;
      while (i < root.length && root.charCodeAt(i) === m.dirPosix.charCodeAt(i)) i++;
      root = root.slice(0, i);
    }

    const mappings = resolved.map(({ dir, dirPosix, entryPoint, importName }) => {
      const tail = dirPosix.slice(root.length);
      return { dir, tail, tailPrefix: tail + '/', entryPoint, importName };
    });

    graph.useRoots(mappings.map(m => m.entryPoint));
    return { root, mappings };
  };

  let resolved: ReturnType<typeof resolveMappings> | null = null;
  const warned = new Set<string>();

  /**
   * The one decline a caller can act on: the entry point was readable and does not carry what the
   * target publishes. Every other decline means "unknown" and stays silent. Widening the barrel
   * makes the import rewritable rather than stopping it (#122).
   */
  const warnUnpublished = (
    mapping: { entryPoint: string; importName: string } | undefined,
    target: string,
    targetSurface: Surface | null
  ): void => {
    if (!mapping) return;

    // Marked before the verdict: esbuild re-resolves the whole graph, and the answer is fixed.
    const key = `${target}\0${mapping.importName}`;
    if (warned.has(key)) return;
    warned.add(key);

    // Required complete though the rewrite test is not: an unreadable `export *` may be
    // publishing the file after all, which is not the caller's to fix.
    const surface = graph.surface(mapping.entryPoint, true);
    if (!surface) return;

    // Absent from the program, so there are no names to quote -- the file itself is the subject.
    const missing = targetSurface && [...targetSurface.keys()].filter(name => !surface.has(name));
    if (missing && missing.length === 0) return;

    const subject = missing
      ? `${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ', ...' : ''} from ${target}`
      : target;
    logger.warn(
      `'${mapping.importName}' does not re-export ${subject}, which the compiler imported ` +
        `directly, so that file is bundled into the consumer instead of shared. Re-export it ` +
        `from ${mapping.entryPoint} to have it shared under '${mapping.importName}'.`
    );
  };

  const resolve: MappingImportResolver = (importedFile, importerFile) => {
    const { root, mappings } = (resolved ??= resolveMappings());

    // Both checks below are prefix tests, which an unnormalized `..` into a mapped lib slips past.
    const imported = path.resolve(importedFile);

    const importedPosix = toPosix(imported);
    if (!importedPosix.startsWith(root)) return null;
    const tail = importedPosix.slice(root.length);
    const containing = mappings.filter(m => tail === m.tail || tail.startsWith(m.tailPrefix));
    if (containing.length === 0) return null;

    // Excluded, or the mapped lib's own bundle would import itself.
    const importer = path.resolve(importerFile);
    const reachableFrom = containing.filter(m => !isUnderDir(importer, m.dir));
    // Nothing below can rewrite or warn when empty, and the two calls it skips build the program.
    if (reachableFrom.length === 0) return null;

    const target = graph.resolveFile(imported);
    if (!target) return null;

    // A file mapped onto its own specifier needs no test, and the one below would wrongly decline
    // a barrel re-exporting a specifier it cannot read.
    const exact = reachableFrom.find(m => m.entryPoint === target);
    if (exact) return exact.importName;

    // The rewrite keeps the property access, so each binding must arrive under the same name.
    const targetSurface = graph.surface(target, true);
    if (!targetSurface) {
      // Unreachable means unpublished, which is actionable; present-but-unreadable is not.
      if (!graph.reaches(target)) warnUnpublished(reachableFrom[0], target, null);
      return null;
    }
    if (targetSurface.size === 0) return null; // a side-effect import; the barrel runs more
    const published = [...targetSurface];

    // Innermost first: a barrel and a deep entry point can share one directory.
    for (const mapping of reachableFrom) {
      const surface = graph.surface(mapping.entryPoint, false);
      if (surface && published.every(([name, binding]) => surface.get(name) === binding)) {
        return mapping.importName;
      }
    }

    warnUnpublished(reachableFrom[0], target, targetSurface);
    return null;
  };

  resolve.reset = () => {
    graph.reset();
    resolved = null;
    warned.clear();
  };

  return resolve;
}
