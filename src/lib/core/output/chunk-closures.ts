import * as path from 'path';
import type { FederationInfo, OutputFile } from '../../domain/core/federation-info.contract.js';
import type { NormalizedFederationOptions } from '../../domain/core/federation-options.contract.js';
import type { FileReaderPort } from '../../domain/utils/io-port.contract.js';
import { CHUNK_PREFIX, toChunkImport } from '../../domain/core/chunk.js';
import { isScript } from '../../utils/script-file.js';
import { lexImports } from '../../utils/lex-imports.js';
import { nodeIo } from '../../utils/io/node-io-adapter.js';
import { resolveOutputPath } from '../../utils/output-path.js';

type ImportsOf = (fileName: string) => readonly string[];

export function staticChunkClosure(roots: readonly string[], importsOf: ImportsOf): string[] {
  const seen = new Set(roots);
  const queue = [...roots];
  const closure: string[] = [];

  while (queue.length > 0) {
    for (const dep of importsOf(queue.pop()!)) {
      if (seen.has(dep)) continue;
      seen.add(dep);
      closure.push(dep);
      queue.push(dep);
    }
  }

  return closure.sort();
}

// Edges are static imports between this build's own scripts: relative ones and its `@nf-internal`
// chunks. Any other bare specifier is resolved by the import map, possibly to another build's file,
// so the walk stops there.
export function readStaticImportGraph(
  io: FileReaderPort,
  outputDir: string,
  files: readonly OutputFile[]
): ImportsOf {
  const scripts = new Set(files.map(f => f.fileName).filter(isScript));
  const byChunkImport = new Map([...scripts].map(fileName => [toChunkImport(fileName), fileName]));
  const memo = new Map<string, string[]>();

  const resolve = (specifier: string): string | undefined => {
    if (specifier.startsWith(CHUNK_PREFIX + '/')) return byChunkImport.get(specifier);
    if (!specifier.startsWith('./')) return undefined;
    const fileName = path.posix.normalize(specifier);
    return scripts.has(fileName) ? fileName : undefined;
  };

  const read = (fileName: string): string[] => {
    const filePath = path.join(outputDir, fileName);
    if (!scripts.has(fileName) || !io.exists(filePath)) return [];
    try {
      return lexImports(io.readText(filePath), fileName)
        .filter(imp => imp.d === -1 && imp.n !== undefined)
        .map(imp => resolve(imp.n!))
        .filter((dep): dep is string => dep !== undefined);
    } catch {
      // validateBareImports has reported it.
      return [];
    }
  };

  return fileName => {
    let deps = memo.get(fileName);
    if (!deps) {
      deps = read(fileName);
      memo.set(fileName, deps);
    }
    return deps;
  };
}

export function addChunkClosuresCore(
  io: FileReaderPort,
  outputDir: string,
  files: readonly OutputFile[],
  federationInfo: FederationInfo
): FederationInfo {
  const importsOf = readStaticImportGraph(io, outputDir, files);

  return {
    ...federationInfo,
    exposes: federationInfo.exposes.map(e => {
      const chunks = staticChunkClosure([e.outFileName], importsOf);
      return chunks.length > 0 ? { ...e, chunks } : e;
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
