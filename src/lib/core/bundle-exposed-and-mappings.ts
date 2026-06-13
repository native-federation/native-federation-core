import fs from 'fs';
import path from 'path';

import type {
  ArtifactInfo,
  ChunkInfo,
  ExposesInfo,
  IntegrityMap,
  SharedInfo,
} from '../domain/core/federation-info.contract.js';
import { integrityForFile } from '../utils/hash-file.js';
import type { NormalizedFederationConfig } from '../domain/config/federation-config.contract.js';
import { createBuildResultMap, popFromResultMap } from './build-result-map.js';
import { logger } from '../utils/logger.js';
import { normalize } from '../utils/normalize.js';
import { type NormalizedFederationOptions } from '../domain/core/federation-options.contract.js';
import { AbortedError } from '../utils/errors.js';
import type { EntryPoint } from './../domain/core/build-adapter.contract.js';
import { rewriteChunkImports } from './rewrite-chunk-imports.js';
import { getBuildAdapter } from './build-adapter.js';

export async function bundleExposedAndMappings(
  config: NormalizedFederationConfig,
  fedOptions: NormalizedFederationOptions,
  externals: string[],
  modifiedFiles?: string[],
  signal?: AbortSignal
): Promise<ArtifactInfo> {
  if (signal?.aborted) {
    throw new AbortedError('[bundle-exposed-and-mappings] Aborted before bundling');
  }

  const shared: EntryPoint[] = Object.entries(config.sharedMappings).map(
    ([entryPoint, mappedImport]) => {
      return {
        fileName: entryPoint,
        outName: mappedImport.replace(/[^A-Za-z0-9]/g, '_') + '.js',
        key: mappedImport,
      };
    }
  );
  const exposes: Array<EntryPoint & { element?: string }> = Object.entries(config.exposes).map(
    ([key, expose]) => {
      const outFilePath = key + '.js';
      return { fileName: expose.file, outName: outFilePath, key, element: expose.element };
    }
  );

  const entryPoints: EntryPoint[] = [...shared, ...exposes];

  const hash = !fedOptions.dev;

  let result;
  try {
    if (!modifiedFiles) {
      await getBuildAdapter().setup('mapping-or-exposed', {
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

    result = await getBuildAdapter().build('mapping-or-exposed', {
      signal,
      modifiedFiles,
    });

    if (signal?.aborted) {
      throw new AbortedError('[bundle-exposed-and-mappings] Aborted after bundle');
    }
  } catch (error) {
    if (!(error instanceof AbortedError)) {
      logger.error('Error building federation artifacts');
    }
    throw error;
  }

  const resultMap = createBuildResultMap(result, hash, [
    ...shared.map(s => s.outName),
    ...exposes.map(e => e.outName),
  ]);

  const sharedResult: Array<SharedInfo> = [];
  const entryFiles: string[] = [];

  // Pick shared-mappings
  for (const item of shared) {
    const distEntryFile = popFromResultMap(resultMap, item.outName);
    sharedResult.push(
      toSharedMappingInfo(item.fileName, item.key!, path.basename(distEntryFile), config, fedOptions)
    );
    entryFiles.push(distEntryFile);
  }

  const exposedResult: Array<ExposesInfo> = [];

  // Pick exposed-modules
  for (const item of exposes) {
    const distEntryFile = popFromResultMap(resultMap, item.outName);

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
    entryFiles.push(distEntryFile);
  }

  // Remove .map files
  Object.keys(resultMap)
    .filter(f => f.endsWith('.map'))
    .forEach(f => popFromResultMap(resultMap, f));

  // Process remaining chunks and lazy loaded internal modules
  let exportedChunks: ChunkInfo | undefined = undefined;
  const chunkPaths: string[] = [];
  if (config.chunks && config.features.denseChunking) {
    for (const entryFile of entryFiles) rewriteChunkImports(entryFile);
    chunkPaths.push(...Object.values(resultMap));
    exportedChunks = {
      ['mapping-or-exposed']: chunkPaths.map(chunk => path.basename(chunk)),
    };
  }

  // Must run after rewriteChunkImports so SRI matches the final on-disk bytes.
  let integrity: IntegrityMap | undefined;
  if (config.features.integrityHashes) {
    integrity = {};
    for (const filePath of [...entryFiles, ...chunkPaths]) {
      if (!fs.existsSync(filePath)) continue;
      integrity[path.basename(filePath)] = integrityForFile(filePath);
    }
  }

  return { mappings: sharedResult, exposes: exposedResult, chunks: exportedChunks, integrity };
}

export function describeExposed(
  config: NormalizedFederationConfig,
  options: NormalizedFederationOptions
): Array<ExposesInfo> {
  const result: Array<ExposesInfo> = [];

  for (const key in config.exposes) {
    const expose = config.exposes[key]!;
    const localPath = normalize(
      path.normalize(path.join(options.workspaceRoot, expose.file))
    );

    result.push({
      key,
      outFileName: '',
      ...(expose.element && { element: expose.element }),
      dev: !options.dev
        ? undefined
        : {
            entryPoint: localPath,
          },
    });
  }

  return result;
}

export function describeSharedMappings(
  config: NormalizedFederationConfig,
  fedOptions: NormalizedFederationOptions
): Array<SharedInfo> {
  const result: Array<SharedInfo> = [];

  for (const [mappedPath, mappedImport] of Object.entries(config.sharedMappings)) {
    result.push(toSharedMappingInfo(mappedPath, mappedImport, '', config, fedOptions));
  }

  return result;
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
  return {
    packageName: mappedImport,
    outFileName,
    requiredVersion: mappingVersion.length > 0 ? '~' + mappingVersion : '',
    singleton: true,
    strictVersion: config.features.mappingVersion,
    version: mappingVersion,
    dev: !fedOptions.dev
      ? undefined
      : {
          entryPoint: normalize(path.normalize(mappedPath)),
        },
  };
}

export function getMappingVersion(fileName: string, workspaceRoot: string): string {
  const resolvedRoot = path.resolve(workspaceRoot);
  let dir = path.dirname(path.resolve(fileName));

  while (true) {
    const candidate = path.join(dir, 'package.json');
    try {
      const json = JSON.parse(fs.readFileSync(candidate, 'utf-8'));
      if (typeof json.version === 'string' && json.version) return json.version;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn(`[getMappingVersion] Failed to parse ${candidate}: ${(err as Error).message}`);
      }
    }
    const parent = path.dirname(dir);
    if (dir === resolvedRoot || parent === dir) return '';
    dir = parent;
  }
}
