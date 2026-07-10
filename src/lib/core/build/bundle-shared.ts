import * as path from 'path';
import type { NormalizedFederationConfig } from '../../domain/config/federation-config.contract.js';
import {
  sharedPackageJsonRepository,
  getPackageInfo,
  type PackageInfo,
} from '../../utils/package/package-info.js';
import type { PackageJsonRepository } from '../../domain/utils/package-json.contract.js';
import type {
  ChunkInfo,
  IntegrityMap,
  SharedInfo,
} from '../../domain/core/federation-info.contract.js';
import type { HashPort, IoPort } from '../../domain/utils/io-port.contract.js';
import { type NormalizedFederationOptions } from '../../domain/core/federation-options.contract.js';
import { logger } from '../../utils/logger.js';
import { nodeIo } from '../../utils/io/node-io-adapter.js';
import { DEFAULT_EXTERNAL_LIST } from './default-external-list.js';
import { isSourceFile, transformChunkImports } from './rewrite-chunk-imports.js';
import { toChunkImport } from '../../domain/core/chunk.js';
import { cacheEntryCore, getChecksumCore, getFilename } from '../cache/cache-persistence.js';
import { computeIntegrityMapCore } from './compute-integrity.js';
import { fileURLToPath } from 'url';
import type { NormalizedExternalConfig } from '../../domain/config/external-config.contract.js';
import type {
  EntryPoint,
  NFBuildAdapter,
  NFBuildAdapterResult,
} from '../../domain/core/build-adapter.contract.js';
import { getBuildAdapter } from './build-adapter.js';

export async function bundleShared(
  sharedBundles: Record<string, NormalizedExternalConfig>,
  config: NormalizedFederationConfig,
  fedOptions: NormalizedFederationOptions,
  externals: string[],
  buildOptions: { platform: 'browser' | 'node'; bundleName: string; chunks: boolean }
): Promise<{
  externals: SharedInfo[];
  chunks?: Record<string, string[]>;
  integrity?: IntegrityMap;
}> {
  return bundleSharedCore(
    { io: nodeIo, repo: sharedPackageJsonRepository, adapter: getBuildAdapter() },
    sharedBundles,
    config,
    fedOptions,
    externals,
    buildOptions
  );
}

interface BundleSharedDeps {
  io: IoPort;
  repo: PackageJsonRepository;
  adapter: NFBuildAdapter;
}

export async function bundleSharedCore(
  deps: BundleSharedDeps,
  sharedBundles: Record<string, NormalizedExternalConfig>,
  config: NormalizedFederationConfig,
  fedOptions: NormalizedFederationOptions,
  externals: string[],
  buildOptions: { platform: 'browser' | 'node'; bundleName: string; chunks: boolean }
): Promise<{
  externals: SharedInfo[];
  chunks?: Record<string, string[]>;
  integrity?: IntegrityMap;
}> {
  // Walk up to the nearest package.json: the file's depth differs across src/dist/test layouts.
  const builderPackageJson = readBuilderPackageJson(deps.io, fileURLToPath(import.meta.url));
  const builderVersion = parseBuilderVersion(builderPackageJson);

  const checksum = getChecksumCore(
    deps.io,
    sharedBundles,
    fedOptions.dev ? '1' : '0',
    builderVersion
  );

  const folder = fedOptions.packageJson
    ? path.dirname(fedOptions.packageJson)
    : fedOptions.workspaceRoot;

  const bundleCache = cacheEntryCore(
    deps.io,
    fedOptions.federationCache.cachePath,
    getFilename(buildOptions.bundleName, fedOptions.dev)
  );

  if (fedOptions?.cacheExternalArtifacts) {
    const cacheMetadata = bundleCache.getMetadata(checksum);
    if (cacheMetadata) {
      logger.info(`Checksum of ${buildOptions.bundleName} matched, re-using cached externals.`);
      bundleCache.copyFiles(path.join(fedOptions.workspaceRoot, fedOptions.outputPath));
      let integrity = cacheMetadata.integrity;
      if (config.features.integrityHashes && !integrity) {
        integrity = computeIntegrityMapCore(
          deps.io,
          cacheMetadata.files,
          fedOptions.federationCache.cachePath
        );
      }
      return {
        externals: cacheMetadata.externals,
        chunks: cacheMetadata.chunks,
        integrity,
      };
    }
  }

  bundleCache.clear();

  const inferredPackageInfos = Object.keys(sharedBundles)
    .filter(packageName => !sharedBundles[packageName]?.packageInfo)
    .map(packageName => getPackageInfo(packageName, folder, deps.repo))
    .filter(pi => !!pi) as PackageInfo[];

  const configuredPackageInfos = Object.keys(sharedBundles)
    .filter(packageName => !!sharedBundles[packageName]?.packageInfo)
    .map(packageName => ({
      packageName,
      ...sharedBundles[packageName]?.packageInfo,
    })) as PackageInfo[];

  const packageInfos = [...inferredPackageInfos, ...configuredPackageInfos];

  const configState = `BUNDLER_CHUNKS;${builderVersion};${JSON.stringify(config)}`;

  const entryPoints: EntryPoint[] = packageInfos.map(pi => {
    const encName = pi.packageName.replace(/[^A-Za-z0-9]/g, '_');
    const outName = createOutName(deps.io, pi, configState, fedOptions, encName);
    return { fileName: pi.entryPoint, outName };
  });

  const fullOutputPath = path.join(fedOptions.workspaceRoot, fedOptions.outputPath);

  // If we build for the browser and don't remote unused deps from the shared config,
  // we need to exclude typical node libs to avoid compilation issues
  const useDefaultExternalList =
    buildOptions.platform === 'browser' && !config.features.ignoreUnusedDeps;

  const additionalExternals = useDefaultExternalList ? DEFAULT_EXTERNAL_LIST : [];

  let bundleResult: NFBuildAdapterResult[];

  try {
    await deps.adapter.setup(buildOptions.bundleName, {
      entryPoints,
      tsConfigPath: fedOptions.tsConfig,
      external: [...additionalExternals, ...externals],
      outdir: fedOptions.federationCache.cachePath,
      mappedPaths: config.sharedMappings,
      dev: fedOptions.dev,
      isMappingOrExposed: false,
      hash: false,
      chunks: buildOptions.chunks,
      platform: buildOptions.platform,
      optimizedMappings: config.features.ignoreUnusedDeps,
      cache: fedOptions.federationCache,
    });

    bundleResult = await deps.adapter.build(buildOptions.bundleName);

    await deps.adapter.dispose(buildOptions.bundleName);

    const cachedFiles = bundleResult.map(br => path.basename(br.fileName));
    // Re-key entry files (version-based names) to a hash of their final content, so a
    // changed bundle always gets a new name and never reuses a stale cached one.
    const hashEntries = fedOptions.dev
      ? new Set<string>()
      : new Set(entryPoints.map(ep => ep.outName));
    const renamed = rewriteImports(
      deps.io,
      cachedFiles,
      fedOptions.federationCache.cachePath,
      hashEntries
    );
    applyRenames(bundleResult, entryPoints, renamed);
  } catch (e) {
    logger.error('Error bundling shared npm package ');
    if (e instanceof Error) {
      logger.error(e.message);
    }

    logger.error('For more information, run in verbose mode');

    logger.notice('');
    logger.notice('');

    logger.notice('** Important Information: ***');
    logger.notice('The error message above shows an issue with bundling a node_module.');
    logger.notice('In most cases this is because you (indirectly) shared a Node.js package,');
    logger.notice('while Native Federation builds for the browser.');
    logger.notice(
      'You can move such packages into devDependencies or skip them in your federation.config.js.'
    );
    logger.notice('');
    logger.notice('More Details: https://bit.ly/nf-issue');

    logger.notice('');
    logger.notice('');

    logger.verbose(e);
    throw e;
  }

  const outFileNames = entryPoints.map(ep => path.join(fullOutputPath, ep.outName));

  const result = buildResult(packageInfos, sharedBundles, outFileNames);

  const chunks = bundleResult.filter(
    br =>
      !br.fileName.endsWith('.map') &&
      !result.find(r => r.outFileName === path.basename(br.fileName))
  );

  /**
   * Chunking
   */
  let exportedChunks: ChunkInfo | undefined = undefined;
  if (buildOptions.chunks && config.features.denseChunking) {
    result.forEach(external => {
      external.bundle = buildOptions.bundleName;
    });
    if (chunks.length > 0) {
      exportedChunks = { [buildOptions.bundleName]: getChunkFileNames(chunks) };
    }
  } else {
    addChunksToResult(chunks, result);
  }

  const persistedFiles = bundleResult.map(r => r.fileName.split(path.sep).pop() ?? r.fileName);

  // Must run after rewriteImports so SRI matches the bytes copied to dist.
  const integrity = config.features.integrityHashes
    ? computeIntegrityMapCore(deps.io, persistedFiles, fedOptions.federationCache.cachePath)
    : undefined;

  bundleCache.persist({
    checksum,
    externals: result,
    files: persistedFiles,
    chunks: exportedChunks,
    integrity,
  });

  bundleCache.copyFiles(path.join(fedOptions.workspaceRoot, fedOptions.outputPath));

  return { externals: result, chunks: exportedChunks, integrity };
}

function rewriteImports(
  io: IoPort,
  cachedFiles: string[],
  cachePath: string,
  hashEntries: Set<string>
): Map<string, string> {
  const renamed = new Map<string, string>();

  for (const file of cachedFiles.filter(isSourceFile)) {
    const filePath = path.join(cachePath, file);
    const rewritten = transformChunkImports(io.readText(filePath), file);

    if (hashEntries.has(file)) {
      const hashedName = `${file.split('.')[0]}.${calcHashCore(io, rewritten)}.js`;
      io.writeText(path.join(cachePath, hashedName), rewritten);
      // Cache hygiene: drop the version-named intermediate (untracked by metadata, so clear() can't reap it).
      io.remove(filePath);
      renamed.set(file, hashedName);
    } else {
      io.writeText(filePath, rewritten);
    }
  }

  return renamed;
}

function applyRenames(
  bundleResult: NFBuildAdapterResult[],
  entryPoints: EntryPoint[],
  renamed: Map<string, string>
): void {
  if (renamed.size === 0) return;

  for (const br of bundleResult) {
    const next = renamed.get(path.basename(br.fileName));
    if (next) br.fileName = path.join(path.dirname(br.fileName), next);
  }

  for (const ep of entryPoints) {
    const next = renamed.get(ep.outName);
    if (next) ep.outName = next;
  }
}

function createOutName(
  io: HashPort,
  pi: PackageInfo,
  configState: string,
  fedOptions: NormalizedFederationOptions,
  encName: string
) {
  const hashBase = pi.version + '_' + pi.entryPoint + '_' + configState;
  const hash = calcHashCore(io, hashBase);

  const outName = fedOptions.dev ? `${encName}.${hash}-dev.js` : `${encName}.${hash}.js`;
  return outName;
}

function buildResult(
  packageInfos: PackageInfo[],
  sharedBundles: Record<string, NormalizedExternalConfig>,
  outFileNames: string[]
) {
  return packageInfos.map(pi => {
    const shared = sharedBundles[pi.packageName];
    return {
      packageName: pi.packageName,
      outFileName: path.basename(outFileNames.shift() || ''),
      requiredVersion: shared?.requiredVersion,
      singleton: shared?.singleton,
      strictVersion: shared?.strictVersion,
      version: pi.version,
      ...(shared?.shareScope && { shareScope: shared.shareScope }),
      // TODO: Decide whether/when we need debug infos
      // dev: !fedOptions.dev
      //   ? undefined
      //   : {
      //       entryPoint: normalize(pi.entryPoint),
      //     },
    } as SharedInfo;
  });
}

function getChunkFileNames(chunks: NFBuildAdapterResult[]): string[] {
  return chunks.map(chunk => path.basename(chunk.fileName));
}

function addChunksToResult(chunks: NFBuildAdapterResult[], result: SharedInfo[]) {
  for (const item of chunks) {
    const fileName = path.basename(item.fileName);
    result.push({
      singleton: false,
      strictVersion: false,
      // Here, the version, singleton and strictversion
      // do not matter because
      // a) a chunk split off by the bundler does
      // not have a version and b) it gets a hash
      // code as part of the file name to be unique
      // when requested via a _versioned_ package.
      version: '0.0.0',
      requiredVersion: '0.0.0',
      packageName: toChunkImport(fileName),
      outFileName: fileName,
      // dev: dev
      //   ? undefined
      //   : {
      //       entryPoint: normalize(fileName),
      //     },
    });
  }
}

export function readBuilderPackageJson(io: IoPort, fromFile: string): string {
  let dir = path.dirname(fromFile);
  for (;;) {
    const candidate = path.join(dir, 'package.json');
    if (io.exists(candidate)) return io.readText(candidate);
    const parent = path.dirname(dir);
    // Stop at the package boundary: terminate at the filesystem root, and never ascend past a
    // node_modules dir into an unrelated (consumer / monorepo-root) package.json.
    if (parent === dir || path.basename(parent) === 'node_modules') return '{}';
    dir = parent;
  }
}

export function parseBuilderVersion(packageJson: string): string {
  try {
    return JSON.parse(packageJson).version ?? '';
  } catch {
    return '';
  }
}

export function calcHashCore(hash: HashPort, hashBase: string) {
  return hash
    .hash('sha256', hashBase)
    .base64()
    .replace(/\//g, '_')
    .replace(/\+/g, '-')
    .replace(/=/g, '')
    .substring(0, 10);
}
