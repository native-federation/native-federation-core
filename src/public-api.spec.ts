import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import ts from 'typescript';
import { lexImports } from './lib/utils/lex-imports.js';

// Every export of every package.json entry, so a change to the public surface shows up as a snapshot
// diff in review. See issues/export-surface.md for what each entry is for.

const SRC = __dirname;

const ENTRIES = {
  '.': 'index.ts',
  './config': 'config.ts',
  './domain': 'domain.ts',
  './internal': 'internal.ts',
  './internal/browser': 'internal/browser.ts',
} as const;

type Entry = keyof typeof ENTRIES;

// Imported by the orchestrator and other browser bundles, so nothing they reach may need Node.
const BROWSER_SAFE: Entry[] = ['./domain', './internal/browser'];

const entryFile = (entry: Entry) => path.join(SRC, ENTRIES[entry]);

function typeExportsByEntry(): Map<Entry, Set<string>> {
  const program = ts.createProgram(
    Object.values(ENTRIES).map(f => path.join(SRC, f)),
    {
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      target: ts.ScriptTarget.ESNext,
      strict: true,
      skipLibCheck: true,
      noEmit: true,
      types: ['node'],
    }
  );
  const checker = program.getTypeChecker();
  const result = new Map<Entry, Set<string>>();
  for (const entry of Object.keys(ENTRIES) as Entry[]) {
    const source = program.getSourceFile(entryFile(entry));
    const moduleSymbol = source && checker.getSymbolAtLocation(source);
    if (!moduleSymbol) throw new Error(`TypeScript could not load ${ENTRIES[entry]}`);
    const types = new Set<string>();
    for (const exported of checker.getExportsOfModule(moduleSymbol)) {
      const target =
        exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
      if (target.flags & ts.SymbolFlags.Type) types.add(exported.name);
    }
    result.set(entry, types);
  }
  return result;
}

// Values come from the module itself: a type-only re-export of a class is a type here, and only the
// runtime tells the two apart without walking every re-export chain.
async function surface(): Promise<Record<string, string[]>> {
  const types = typeExportsByEntry();
  const result: Record<string, string[]> = {};
  for (const entry of Object.keys(ENTRIES) as Entry[]) {
    const values = new Set(Object.keys(await import(entryFile(entry))));
    const names = [...new Set([...values, ...types.get(entry)!])].sort();
    result[entry] = names.map(name => {
      const kind = [values.has(name) && 'value', types.get(entry)!.has(name) && 'type']
        .filter(Boolean)
        .join('+');
      return `${name}: ${kind}`;
    });
  }
  return result;
}

// Relative imports a file keeps at runtime: type-only imports are erased by the build, so they are
// erased here too before the lexer reads the file.
function runtimeImports(file: string): string[] {
  const { outputText } = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext },
    fileName: file,
  });
  return lexImports(outputText, file)
    .map(i => i.n)
    .filter((n): n is string => n !== undefined);
}

function nonRelativeImportsReachedFrom(file: string): string[] {
  const seen = new Set<string>();
  const found: string[] = [];
  const visit = (current: string) => {
    if (seen.has(current)) return;
    seen.add(current);
    for (const specifier of runtimeImports(current)) {
      if (!specifier.startsWith('.')) {
        found.push(`${path.relative(SRC, current)} -> ${specifier}`);
        continue;
      }
      visit(path.resolve(path.dirname(current), specifier).replace(/\.js$/, '.ts'));
    }
  };
  visit(file);
  return found;
}

describe('public API', () => {
  it('exports exactly the snapshotted names from each entry point', async () => {
    expect(await surface()).toMatchSnapshot();
  }, 60_000);

  it('keeps ./internal a superset of ./internal/browser', async () => {
    const all = await surface();
    expect(all['./internal/browser']!.filter(e => !all['./internal']!.includes(e))).toEqual([]);
  }, 60_000);

  it.each(BROWSER_SAFE)('%s reaches no Node built-in or package at runtime', entry => {
    expect(nonRelativeImportsReachedFrom(entryFile(entry))).toEqual([]);
  });

  // Guards the walk itself: an empty result above only means something if it can find one.
  it('finds the Node imports ./internal reaches', () => {
    expect(nonRelativeImportsReachedFrom(entryFile('./internal'))).toContainEqual(
      expect.stringMatching(/ -> (node:)?fs$/)
    );
  });
});
