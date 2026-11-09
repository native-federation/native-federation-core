import * as path from 'path';
import type { ImportSpecifier } from 'es-module-lexer';
import type {
  ChunkMap,
  FederationInfo,
  OutputFile,
} from '../../domain/core/federation-info.contract.js';
import type { NormalizedFederationOptions } from '../../domain/core/federation-options.contract.js';
import type { FileReaderPort } from '../../domain/utils/io-port.contract.js';
import { CHUNK_PREFIX, toChunkImport } from '../../domain/core/chunk.js';
import { isScript } from '../../utils/script-file.js';
import { lexImports } from '../../utils/lex-imports.js';
import { nodeIo } from '../../utils/io/node-io-adapter.js';
import { resolveOutputPath } from '../../utils/output-path.js';

interface FileImports {
  static: readonly string[];
  dynamic: readonly string[];
}

type ImportGraph = (fileName: string) => FileImports;

function closure(roots: readonly string[], next: (fileName: string) => readonly string[]) {
  const seen = new Set(roots);
  const queue = [...roots];
  const reached = new Set<string>();

  while (queue.length > 0) {
    for (const dep of next(queue.pop()!)) {
      if (seen.has(dep)) continue;
      seen.add(dep);
      reached.add(dep);
      queue.push(dep);
    }
  }

  return reached;
}

export function ownerChunks(roots: readonly string[], graph: ImportGraph): ChunkMap {
  const initial = closure(roots, f => graph(f).static);
  const all = closure(roots, f => {
    const g = graph(f);
    return [...g.static, ...g.dynamic];
  });

  const chunks: ChunkMap = {};
  for (const file of [...all].sort()) {
    chunks[toChunkImport(file)] = initial.has(file) ? { file, initial: true } : { file };
  }
  return chunks;
}

// Edges are imports between this build's own scripts: relative ones and its `@nf-internal`
// chunks. Any other bare specifier is resolved by the import map, possibly to another build's file,
// so the walk stops there. A non-literal `import(x)` is no edge: bundlers split only on literal ones.
export function readImportGraph(
  io: FileReaderPort,
  outputDir: string,
  files: readonly OutputFile[]
): ImportGraph {
  const scripts = new Set(files.map(f => f.fileName).filter(isScript));
  const byChunkImport = new Map([...scripts].map(fileName => [toChunkImport(fileName), fileName]));
  const memo = new Map<string, FileImports>();
  const none: FileImports = { static: [], dynamic: [] };

  const resolve = (specifier: string): string | undefined => {
    if (specifier.startsWith(CHUNK_PREFIX + '/')) return byChunkImport.get(specifier);
    if (!specifier.startsWith('./')) return undefined;
    const fileName = path.posix.normalize(specifier);
    return scripts.has(fileName) ? fileName : undefined;
  };

  const resolveAll = (imports: readonly ImportSpecifier[]) =>
    imports.map(imp => resolve(imp.n!)).filter((dep): dep is string => dep !== undefined);

  const read = (fileName: string): FileImports => {
    const filePath = path.join(outputDir, fileName);
    if (!scripts.has(fileName) || !io.exists(filePath)) return none;
    try {
      const imports = lexImports(io.readText(filePath), fileName).filter(
        imp => imp.n !== undefined
      );
      return {
        static: resolveAll(imports.filter(imp => imp.d === -1)),
        // d === -2 is import.meta, not an import.
        dynamic: resolveAll(imports.filter(imp => imp.d > -1)),
      };
    } catch {
      // validateBareImports has reported it.
      return none;
    }
  };

  return fileName => {
    let imports = memo.get(fileName);
    if (!imports) {
      imports = read(fileName);
      memo.set(fileName, imports);
    }
    return imports;
  };
}

export function addChunkClosuresCore(
  io: FileReaderPort,
  outputDir: string,
  files: readonly OutputFile[],
  federationInfo: FederationInfo
): FederationInfo {
  const graph = readImportGraph(io, outputDir, files);

  return {
    ...federationInfo,
    exposes: federationInfo.exposes.map(e => {
      const chunks = ownerChunks([e.outFileName], graph);
      return Object.keys(chunks).length > 0 ? { ...e, chunks } : e;
    }),
  };
}

export function addChunkClosures(
  fedOptions: NormalizedFederationOptions,
  files: readonly OutputFile[],
  federationInfo: FederationInfo
): FederationInfo {
  return addChunkClosuresCore(nodeIo, resolveOutputPath(fedOptions), files, federationInfo);
}
