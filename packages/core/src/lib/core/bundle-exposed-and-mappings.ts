import fs from 'fs';
import path from 'path';

import type {
  ArtifactInfo,
  ExposesInfo,
  SharedInfo,
} from '../domain/core/federation-info.contract.js';
import type { NormalizedFederationConfig } from '../domain/config/federation-config.contract.js';
import { createBuildResultMap, lookupInResultMap } from '../utils/build-result-map.js';
import { bundle } from '../utils/build-utils.js';
import { logger } from '../utils/logger.js';
import { normalize } from '../utils/normalize.js';
import { type FederationOptions } from '../domain/core/federation-options.contract.js';
import { AbortedError } from '../utils/errors.js';
import type { EntryPoint } from './../domain/core/build-adapter.contract.js';

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

  for (const item of shared) {
    sharedResult.push({
      packageName: item.key!,
      outFileName: lookupInResultMap(resultMap, item.outName),
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
  }

  const exposedResult: Array<ExposesInfo> = [];

  for (const item of exposes) {
    exposedResult.push({
      key: item.key!,
      outFileName: lookupInResultMap(resultMap, item.outName),
      dev: !fedOptions.dev
        ? undefined
        : {
            entryPoint: normalize(path.join(fedOptions.workspaceRoot, item.fileName!)),
          },
    });
  }

  return { mappings: sharedResult, exposes: exposedResult };
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
