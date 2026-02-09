import fs from 'fs';
import path from 'path';

import type {
  ArtifactInfo,
  ChunkInfo,
  ExposesInfo,
  SharedInfo,
} from '../domain/core/federation-info.contract.js';
import type { NormalizedFederationConfig } from '../domain/config/federation-config.contract.js';
import { createBuildResultMap, popFromResultMap } from '../utils/build-result-map.js';
import { bundle } from '../utils/build-utils.js';
import { logger } from '../utils/logger.js';
import { normalize } from '../utils/normalize.js';
import { type FederationOptions } from '../domain/core/federation-options.contract.js';
import { AbortedError } from '../utils/errors.js';
import type { EntryPoint } from './../domain/core/build-adapter.contract.js';
import { rewriteChunkImports } from '../utils/rewrite-chunk-imports.js';

export async function bundleExposedAndMappings(
  config: NormalizedFederationConfig,
  fedOptions: FederationOptions,
  externals: string[],
  signal?: AbortSignal
): Promise<ArtifactInfo> {
  if (signal?.aborted) {
    throw new AbortedError('[bundle-exposed-and-mappings] Aborted before bundling');
  }

  const shared: EntryPoint[] = config.sharedMappings.map(sm => {
    const entryPoint = sm.path;
    const tmp = sm.key.replace(/[^A-Za-z0-9]/g, '_');
    const outFilePath = tmp + '.js';
    return { fileName: entryPoint, outName: outFilePath, key: sm.key };
  });
  const exposes: EntryPoint[] = Object.entries(config.exposes).map(([key, entry]) => {
    const outFilePath = key + '.js';
    return { fileName: entry, outName: outFilePath, key };
  });

  const entryPoints: EntryPoint[] = [...shared, ...exposes];

  const hash = !fedOptions.dev;

  logger.info('Building federation artifacts');

  let result;
  try {
    result = await bundle({
      entryPoints,
      outdir: fedOptions.outputPath,
      tsConfigPath: fedOptions.tsConfig,
      external: externals,
      dev: !!fedOptions.dev,
      watch: fedOptions.watch,
      mappedPaths: config.sharedMappings,
      kind: 'mapping-or-exposed',
      chunks:
        (typeof fedOptions.chunks === 'boolean' && fedOptions.chunks) ||
        (typeof fedOptions.chunks === 'object' && !!fedOptions.chunks.enable),
      hash,
      optimizedMappings: config.features.ignoreUnusedDeps,
      signal,
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

  const resultMap = createBuildResultMap(result, hash);

  const sharedResult: Array<SharedInfo> = [];
  const entryFiles: string[] = [];

  // Pick shared-mappings
  for (const item of shared) {
    const distEntryFile = popFromResultMap(resultMap, item.outName);
    sharedResult.push({
      packageName: item.key!,
      outFileName: path.basename(distEntryFile),
      requiredVersion: '',
      singleton: true,
      strictVersion: false,
      version: config.features.mappingVersion ? getMappingVersion(item.fileName) : '',
      dev: !fedOptions.dev
        ? undefined
        : {
            entryPoint: normalize(path.normalize(item.fileName)),
          },
    });
    entryFiles.push(distEntryFile);
  }

  const exposedResult: Array<ExposesInfo> = [];

  // Pick exposed-modules
  for (const item of exposes) {
    const distEntryFile = popFromResultMap(resultMap, item.outName);

    exposedResult.push({
      key: item.key!,
      outFileName: path.basename(distEntryFile),
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
  if (typeof fedOptions.chunks === 'object' && fedOptions.chunks.dense === true) {
    for (const entryFile of entryFiles) rewriteChunkImports(entryFile);
    exportedChunks = {
      ['mapping-or-exposed']: Object.values(resultMap).map(chunk => path.basename(chunk)),
    };
  }

  return { mappings: sharedResult, exposes: exposedResult, chunks: exportedChunks };
}

export function describeExposed(
  config: NormalizedFederationConfig,
  options: FederationOptions
): Array<ExposesInfo> {
  const result: Array<ExposesInfo> = [];

  for (const key in config.exposes) {
    const localPath = normalize(
      path.normalize(path.join(options.workspaceRoot, config.exposes[key]!))
    );

    result.push({
      key,
      outFileName: '',
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
  fedOptions: FederationOptions
): Array<SharedInfo> {
  const result: Array<SharedInfo> = [];

  for (const m of config.sharedMappings) {
    result.push({
      packageName: m.key,
      outFileName: '',
      requiredVersion: '',
      singleton: true,
      strictVersion: false,
      version: config.features.mappingVersion ? getMappingVersion(m.path) : '',
      dev: !fedOptions.dev
        ? undefined
        : {
            entryPoint: normalize(path.normalize(m.path)),
          },
    });
  }

  return result;
}

function getMappingVersion(fileName: string): string {
  const entryFileDir = path.dirname(fileName);
  const cand1 = path.join(entryFileDir, 'package.json');
  const cand2 = path.join(path.dirname(entryFileDir), 'package.json');

  const packageJsonPath = [cand1, cand2].find(cand => fs.existsSync(cand));
  if (packageJsonPath) {
    const json = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    return json.version ?? '';
  }
  return '';
}
