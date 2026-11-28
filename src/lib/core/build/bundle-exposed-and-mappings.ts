import path from 'path';

import type {
  ArtifactInfo,
  ExposesInfo,
  IntegrityMap,
  SharedInfo,
} from '../../domain/core/federation-info.contract.js';
import type { IoPort } from '../../domain/utils/io-port.contract.js';
import type { NormalizedFederationConfig } from '../../domain/config/federation-config.contract.js';
import { createBuildResultMap, popFromResultMap } from './build-result-map.js';
import { computeIntegrityMapCore } from './compute-integrity.js';
import { resolveOutputPath } from '../../utils/output-path.js';
import { logger } from '../../utils/logger.js';
import { normalize } from '../../utils/normalize.js';
import { nodeIo } from '../../utils/io/node-io-adapter.js';
import { type NormalizedFederationOptions } from '../../domain/core/federation-options.contract.js';
import { AbortedError } from '../../utils/errors.js';
import type {
  EntryPoint,
  NFBuildAdapter,
  NFBundleKind,
} from '../../domain/core/build-adapter.contract.js';
import { rewriteChunkImportsCore } from './rewrite-chunk-imports.js';
import { renameChunksByContentCore } from './rename-chunks-by-content.js';
import { getBuildAdapter } from './build-adapter.js';
import { planMappingBundles } from './mapping-bundle-plan.js';
import { mappingRecord, type MappingRecord } from './mapping-record.js';
import {
  assertAbsoluteFileNames,
  assertWrittenToOutdir,
  toOutputFiles,
} from '../output/output-files.js';
import { isScript } from '../../utils/script-file.js';

// Shared mappings and exposed modules build separately so the bundler cannot factor one chunk out
// of both: the exposed module would keep this build's copy while the import map may serve the
// mapping from another remote, with a copy of its own.
// The exposed build's name is hard-coded in the orchestrator, which registers it for every remote.
const EXPOSED_BUNDLE = 'mapping-or-exposed';

export async function bundleExposedAndMappings(
  config: NormalizedFederationConfig,
  fedOptions: NormalizedFederationOptions,
  externals: string[],
  modifiedFiles?: string[],
  signal?: AbortSignal
): Promise<ArtifactInfo> {
  return bundleExposedAndMappingsCore(
    { adapter: getBuildAdapter(), io: nodeIo },
    config,
    fedOptions,
    externals,
    modifiedFiles,
    signal
  );
}

export async function bundleExposedAndMappingsCore(
  deps: { adapter: NFBuildAdapter; io?: IoPort },
  config: NormalizedFederationConfig,
  fedOptions: NormalizedFederationOptions,
  externals: string[],
  modifiedFiles?: string[],
  signal?: AbortSignal
): Promise<ArtifactInfo> {
  if (signal?.aborted) {
    throw new AbortedError('[bundle-exposed-and-mappings] Aborted before bundling');
  }
  const io = deps.io ?? nodeIo;
  const records = new Map(
    Object.entries(config.sharedMappings).map(([mappedPath, mappedImport]) => [
      mappedPath,
      mappingRecord(io, mappedPath, mappedImport, config, fedOptions),
    ])
  );

  const mappingPlans = planMappingBundles(config).map(plan => ({
    bundleName: plan.bundleName,
    chunks: plan.chunks,
    entryPoints: Object.entries(plan.entries).map(([entryPoint, mappedImport]) => ({
      fileName: entryPoint,
      outName: mappedImport.replace(/[^A-Za-z0-9]/g, '_') + '.js',
      key: mappedImport,
    })),
  }));
  const outNames = flatOutNames(Object.keys(config.exposes));
  const exposes: Array<EntryPoint & { element?: string }> = Object.entries(config.exposes).map(
    ([key, expose], i) => {
      // Absolute because adapters resolve a relative entry against cwd, not workspaceRoot.
      const fileName = path.resolve(fedOptions.workspaceRoot, expose.file);
      return { fileName, outName: outNames[i]!, key, element: expose.element };
    }
  );

  if (!modifiedFiles) {
    warnSharedOutNames([
      ...mappingPlans.flatMap(plan =>
        plan.entryPoints.map(ep => ({ outName: ep.outName, label: `shared mapping '${ep.key}'` }))
      ),
      ...exposes.map(ep => ({ outName: ep.outName, label: `exposed module '${ep.key}'` })),
    ]);
  }

  const hash = !fedOptions.dev;

  const runBuild = async (
    bundleName: string,
    entryPoints: EntryPoint[],
    chunks: boolean,
    kind: NFBundleKind
  ): Promise<Record<string, string>> => {
    if (entryPoints.length === 0) return {};

    let result;
    try {
      if (!modifiedFiles) {
        await deps.adapter.setup(bundleName, {
          entryPoints,
          outdir: resolveOutputPath(fedOptions),
          tsConfigPath: fedOptions.tsConfig,
          external: externals,
          dev: !!fedOptions.dev,
          watch: fedOptions.watch,
          mappedPaths: config.sharedMappings,
          chunks,
          hash,
          optimizedMappings: config.features.ignoreUnusedDeps,
          kind,
          isMappingOrExposed: true,
          cache: fedOptions.federationCache,
        });
      }

      result = await deps.adapter.build(bundleName, { signal, modifiedFiles });

      if (signal?.aborted) {
        throw new AbortedError('[bundle-exposed-and-mappings] Aborted after bundle');
      }
      assertAbsoluteFileNames(result);
    } catch (error) {
      if (!(error instanceof AbortedError)) {
        logger.error('Error building federation artifacts');
      }
      throw error;
    }

    return createBuildResultMap(
      result,
      hash,
      entryPoints.map(ep => ep.outName)
    );
  };

  const written: string[] = [];

  // Renamed before the next build runs, so the two never hold the bundler's names at once.
  const collectBundleOutputs = (
    resultMap: Record<string, string>,
    entries: string[],
    splits: boolean
  ) => {
    written.push(
      ...finalizeBundleOutputs(io, resultMap, entries, {
        splits,
        outdir: resolveOutputPath(fedOptions),
      })
    );
  };

  const sharedResult: Array<SharedInfo> = [];

  // Pick shared-mappings
  for (const plan of mappingPlans) {
    logger.info(`Bundling shared mappings with bundle type '${plan.bundleName}'`);
    const start = process.hrtime();
    const results = await runBuild(plan.bundleName, plan.entryPoints, plan.chunks, 'mapping');
    const files: string[] = [];

    for (const item of plan.entryPoints) {
      const distEntryFile = popFromResultMap(results, item.outName);
      const mapping = toSharedMappingInfo(
        item.fileName,
        item.key,
        path.basename(distEntryFile),
        records.get(item.fileName)!,
        fedOptions
      );
      sharedResult.push(mapping);
      files.push(distEntryFile);
    }

    collectBundleOutputs(results, files, plan.chunks);
    logger.measure(start, `Bundling '${plan.bundleName}' shared mappings`);
  }

  if (exposes.length > 0) logger.info('Bundling exposed modules');
  const exposedStart = process.hrtime();
  const exposedResults = await runBuild(EXPOSED_BUNDLE, exposes, config.chunks, 'exposed');

  const exposedResult: Array<ExposesInfo> = [];
  const exposedFiles: string[] = [];

  // Pick exposed-modules
  for (const item of exposes) {
    const distEntryFile = popFromResultMap(exposedResults, item.outName);

    exposedResult.push({
      key: item.key!,
      outFileName: path.basename(distEntryFile),
      ...(item.element && { element: item.element }),
      dev: !fedOptions.dev
        ? undefined
        : {
            entryPoint: normalize(item.fileName),
          },
    });
    exposedFiles.push(distEntryFile);
  }

  collectBundleOutputs(exposedResults, exposedFiles, config.chunks);
  if (exposes.length > 0) logger.measure(exposedStart, 'Bundling exposed modules');

  const outputPaths = [...new Set(written)];
  // Must run after rewriteChunkImports so SRI matches the final on-disk bytes.
  const integrity: IntegrityMap | undefined = config.features.integrityHashes
    ? computeIntegrityMapCore(io, outputPaths, '')
    : undefined;

  return {
    mappings: sharedResult,
    exposes: exposedResult,
    integrity,
    outputFiles: toOutputFiles(outputPaths, 'browser'),
  };
}

// Output names keep only [A-Za-z0-9_] and file systems may ignore case, so two entries can share a
// file, which a dev build (no hash) writes one over the other (core#196).
function warnSharedOutNames(entries: Array<{ outName: string; label: string }>): void {
  const byName = new Map<string, { outName: string; labels: string[] }>();
  for (const { outName, label } of entries) {
    const group = byName.get(outName.toLowerCase());
    if (group) group.labels.push(label);
    else byName.set(outName.toLowerCase(), { outName, labels: [label] });
  }
  for (const { outName, labels } of byName.values()) {
    if (labels.length === 1) continue;
    logger.warn(
      `${labels.join(' and ')} are written as '${outName}'. A dev build writes one over the ` +
        `other, so one is served for both, and a bundle holding both fails. Rename one of them.`
    );
  }
}

// Only a second key with the same last segment gets a suffix, so no other published name changes.
function flatOutNames(keys: string[]): string[] {
  const stems = keys.map(key => path.posix.basename(key));
  const reserved = new Set(stems);
  const emitted = new Set<string>();
  return stems.map(stem => {
    if (!emitted.has(stem)) {
      emitted.add(stem);
      return `${stem}.js`;
    }
    let i = 2;
    while (reserved.has(`${stem}_${i}`)) i++;
    reserved.add(`${stem}_${i}`);
    return `${stem}_${i}.js`;
  });
}

// `resultMap` holds what is left once the entries were popped from it: chunks, maps and assets.
function finalizeBundleOutputs(
  io: IoPort,
  resultMap: Record<string, string>,
  entries: string[],
  { splits, outdir }: { splits: boolean; outdir: string }
): string[] {
  const outputs = Object.values(resultMap);
  if (!splits || entries.length === 0) return [...entries, ...outputs];

  const chunks = outputs.filter(file => isScript(file));
  assertWrittenToOutdir(io, [...entries, ...chunks], outdir);
  const chunkNames = new Set(chunks.map(chunk => path.basename(chunk)));
  for (const entryFile of entries) rewriteChunkImportsCore(io, entryFile, chunkNames);
  const renamed = renameChunks(io, chunks, entries);
  return [...entries, ...outputs.map(file => renamedPath(file, renamed))];
}

// A renamed chunk's source map moves with it to `<target>.map`.
function renamedPath(file: string, renamed: Map<string, string>): string {
  const name = path.basename(file);
  const isSourceMap = name.endsWith('.map');
  const source = isSourceMap ? name.slice(0, -'.map'.length) : name;
  const target = renamed.get(source);
  if (!target) return file;
  return path.join(path.dirname(file), isSourceMap ? `${target}.map` : target);
}

// Chunks are published by name in the `chunks` map, so the name is made to say what the bytes are.
function renameChunks(io: IoPort, chunkPaths: string[], entryFiles: string[]): Map<string, string> {
  if (chunkPaths.length === 0) return new Map();
  const dir = path.dirname(chunkPaths[0]!);
  return renameChunksByContentCore(
    io,
    dir,
    [...new Set(chunkPaths.map(chunk => path.basename(chunk)))],
    entryFiles.map(entry => path.basename(entry))
  );
}

function toSharedMappingInfo(
  mappedPath: string,
  mappedImport: string,
  outFileName: string,
  record: MappingRecord,
  fedOptions: NormalizedFederationOptions
): SharedInfo {
  return {
    packageName: mappedImport,
    outFileName,
    ...record,
    dev: !fedOptions.dev
      ? undefined
      : {
          entryPoint: normalize(path.normalize(mappedPath)),
        },
  };
}
