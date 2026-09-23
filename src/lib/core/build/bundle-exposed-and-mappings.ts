import path from 'path';

import type {
  ArtifactInfo,
  ChunkInfo,
  ExposesInfo,
  IntegrityMap,
  SharedInfo,
} from '../../domain/core/federation-info.contract.js';
import type { FileReaderPort, IoPort } from '../../domain/utils/io-port.contract.js';
import type { NormalizedFederationConfig } from '../../domain/config/federation-config.contract.js';
import { createBuildResultMap, popFromResultMap } from './build-result-map.js';
import { computeIntegrityMapCore } from './compute-integrity.js';
import { logger } from '../../utils/logger.js';
import { normalize } from '../../utils/normalize.js';
import { nodeIo } from '../../utils/io/node-io-adapter.js';
import { type NormalizedFederationOptions } from '../../domain/core/federation-options.contract.js';
import { AbortedError } from '../../utils/errors.js';
import type { EntryPoint, NFBuildAdapter } from '../../domain/core/build-adapter.contract.js';
import { rewriteChunkImportsCore } from './rewrite-chunk-imports.js';
import { renameChunksByContentCore } from './rename-chunks-by-content.js';
import { getBuildAdapter } from './build-adapter.js';
import { resolveMappingConfig } from '../../config/mapping-utils.js';
import { applyAutoRequiredOptions } from '../../config/version-lookup.js';
import type { AutoRequiredOptions } from '../../domain/config/external-config.contract.js';
import { planMappingBundles } from './mapping-bundle-plan.js';

// Shared mappings and exposed modules build separately so the bundler cannot factor one chunk out
// of both: a chunk spanning them is reached through two import trails and evaluated twice.
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

  const mappingPlans = planMappingBundles(config).map(plan => ({
    bundleName: plan.bundleName,
    entryPoints: Object.entries(plan.entries).map(([entryPoint, mappedImport]) => ({
      fileName: entryPoint,
      outName: mappedImport.replace(/[^A-Za-z0-9]/g, '_') + '.js',
      key: mappedImport,
    })),
  }));
  const exposes: Array<EntryPoint & { element?: string }> = Object.entries(config.exposes).map(
    ([key, expose]) => {
      const outFilePath = key + '.js';
      return { fileName: expose.file, outName: outFilePath, key, element: expose.element };
    }
  );

  const hash = !fedOptions.dev;

  const runBuild = async (
    bundleName: string,
    entryPoints: EntryPoint[]
  ): Promise<Record<string, string>> => {
    if (entryPoints.length === 0) return {};

    let result;
    try {
      if (!modifiedFiles) {
        await deps.adapter.setup(bundleName, {
          entryPoints,
          outdir: fedOptions.outputPath,
          tsConfigPath: fedOptions.tsConfig,
          external: externals,
          dev: !!fedOptions.dev,
          watch: fedOptions.watch,
          mappedPaths: config.sharedMappings,
          chunks: config.chunks,
          hash,
          optimizedMappings: config.features.ignoreUnusedDeps,
          isMappingOrExposed: true,
          cache: fedOptions.federationCache,
        });
      }

      result = await deps.adapter.build(bundleName, { signal, modifiedFiles });

      if (signal?.aborted) {
        throw new AbortedError('[bundle-exposed-and-mappings] Aborted after bundle');
      }
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

  const dense = config.chunks && config.features.denseChunking;
  const exportedChunks: ChunkInfo = {};
  const chunkPaths: string[] = [];

  // Renamed before the next build runs, so the two never hold the bundler's names at once.
  const takeChunks = (bundleName: string, resultMap: Record<string, string>, entries: string[]) => {
    if (!dense || entries.length === 0) return;
    const chunks = chunksOf(resultMap);
    for (const entryFile of entries) rewriteChunkImportsCore(io, entryFile);
    const renamed = renameChunks(io, chunks, entries);
    const paths = chunks.map(chunk =>
      path.join(path.dirname(chunk), renamed.get(path.basename(chunk)) ?? path.basename(chunk))
    );
    exportedChunks[bundleName] = paths.map(chunk => path.basename(chunk));
    chunkPaths.push(...paths);
  };

  const sharedResult: Array<SharedInfo> = [];
  const mappingFiles: string[] = [];

  // Pick shared-mappings
  for (const plan of mappingPlans) {
    logger.info(`Bundling shared mappings with bundle type '${plan.bundleName}'`);
    const start = process.hrtime();
    const results = await runBuild(plan.bundleName, plan.entryPoints);
    const files: string[] = [];

    for (const item of plan.entryPoints) {
      const distEntryFile = popFromResultMap(results, item.outName);
      const mapping = toSharedMappingInfo(
        item.fileName,
        item.key,
        path.basename(distEntryFile),
        config,
        fedOptions
      );
      if (dense) mapping.bundle = plan.bundleName;
      sharedResult.push(mapping);
      files.push(distEntryFile);
    }

    takeChunks(plan.bundleName, results, files);
    mappingFiles.push(...files);
    logger.measure(start, `Bundling '${plan.bundleName}' shared mappings`);
  }

  if (exposes.length > 0) logger.info('Bundling exposed modules');
  const exposedStart = process.hrtime();
  const exposedResults = await runBuild(EXPOSED_BUNDLE, exposes);

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
            entryPoint: normalize(path.join(fedOptions.workspaceRoot, item.fileName!)),
          },
    });
    exposedFiles.push(distEntryFile);
  }

  takeChunks(EXPOSED_BUNDLE, exposedResults, exposedFiles);
  if (exposes.length > 0) logger.measure(exposedStart, 'Bundling exposed modules');

  // Must run after rewriteChunkImports so SRI matches the final on-disk bytes.
  const integrity: IntegrityMap | undefined = config.features.integrityHashes
    ? computeIntegrityMapCore(io, [...mappingFiles, ...exposedFiles, ...chunkPaths], '')
    : undefined;

  return {
    mappings: sharedResult,
    exposes: exposedResult,
    chunks: Object.keys(exportedChunks).length > 0 ? exportedChunks : undefined,
    integrity,
  };
}

function chunksOf(resultMap: Record<string, string>): string[] {
  return Object.entries(resultMap)
    .filter(([file]) => !file.endsWith('.map'))
    .map(([, chunkPath]) => chunkPath);
}

// Chunks are published by name in the `chunks` map, so the name is made to say what the bytes are.
function renameChunks(
  io: IoPort,
  chunkPaths: string[],
  entryFiles: string[]
): Map<string, string> {
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
  config: NormalizedFederationConfig,
  fedOptions: NormalizedFederationOptions
): SharedInfo {
  const mappingVersion = config.features.mappingVersion
    ? getMappingVersion(mappedPath, fedOptions.workspaceRoot)
    : '';

  const mappingConfig = resolveMappingConfig(
    mappedImport,
    config.sharedMappingsConfig,
    config.features.mappingVersion
  );
  const requiredVersionCfg = mappingConfig.requiredVersion;
  // An explicit version drives requiredVersion too, the same way the detected one does.
  const explicitVersion =
    requiredVersionCfg && typeof requiredVersionCfg === 'object'
      ? requiredVersionCfg.version
      : undefined;
  const asked = explicitVersion && explicitVersion !== 'auto' ? explicitVersion : undefined;
  const version = asked ?? mappingConfig.version ?? mappingVersion;

  return {
    packageName: mappedImport,
    outFileName,
    requiredVersion: mappingRequiredVersion(requiredVersionCfg, version),
    singleton: mappingConfig.singleton,
    strictVersion: mappingConfig.strictVersion,
    version,
    ...(mappingConfig.shareScope && { shareScope: mappingConfig.shareScope }),
    ...(mappingConfig.pool && { pool: mappingConfig.pool }),
    dev: !fedOptions.dev
      ? undefined
      : {
          entryPoint: normalize(path.normalize(mappedPath)),
        },
  };
}

// '~' stays the default range for a mapping; see README 'Configuring shared mappings'.
function mappingRequiredVersion(
  cfg: string | AutoRequiredOptions | undefined,
  version: string
): string {
  if (typeof cfg === 'string') return cfg;
  if (version.length === 0) return '';
  return applyAutoRequiredOptions(version, { range: cfg?.range ?? '~' });
}

export function getMappingVersionCore(
  io: FileReaderPort,
  fileName: string,
  workspaceRoot: string
): string {
  const resolvedRoot = path.resolve(workspaceRoot);
  let dir = path.dirname(path.resolve(fileName));

  while (true) {
    const candidate = path.join(dir, 'package.json');
    if (io.isFile(candidate)) {
      try {
        const json = JSON.parse(io.readText(candidate));
        if (typeof json.version === 'string' && json.version) return json.version;
      } catch (err: unknown) {
        logger.warn(`[getMappingVersion] Failed to parse ${candidate}: ${(err as Error).message}`);
      }
    }
    const parent = path.dirname(dir);
    if (dir === resolvedRoot || parent === dir) return '';
    dir = parent;
  }
}

export function getMappingVersion(fileName: string, workspaceRoot: string): string {
  return getMappingVersionCore(nodeIo, fileName, workspaceRoot);
}
