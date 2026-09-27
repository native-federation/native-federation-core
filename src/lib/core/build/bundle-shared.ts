import * as path from 'path';
import type { NormalizedFederationConfig } from '../../domain/config/federation-config.contract.js';
import {
  sharedPackageJsonRepository,
  getPackageInfo,
  installedVersions,
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
import {
  applyEdits,
  collectSpecifierEdits,
  isSourceFile,
  shiftSourceMap,
} from './rewrite-chunk-imports.js';
import { renameChunksByContentCore } from './rename-chunks-by-content.js';
import { hashBuildMetadata, hashEntryContent } from '../../utils/hash.js';
import { toChunkImport } from '../../domain/core/chunk.js';
import { cacheEntryCore, getChecksumCore, getFilename } from '../cache/cache-persistence.js';
import { linkedContentSignals } from './resolve-shared-dirs.js';
import { computeIntegrityMapCore } from './compute-integrity.js';
import { fileURLToPath } from 'url';
import type { NormalizedExternalConfig } from '../../domain/config/external-config.contract.js';
import type {
  EntryPoint,
  NFBuildAdapter,
  NFBuildAdapterResult,
} from '../../domain/core/build-adapter.contract.js';
import { getBuildAdapter } from './build-adapter.js';
import { synthesizeCjsNamedExportsEntry, type ModuleEvaluator } from './synthesize-cjs-exports.js';
import { createRequire } from 'module';
import { toPosix } from '../../utils/path-patterns.js';

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
  const requireFromWorkspace = createRequire(path.join(fedOptions.workspaceRoot, 'index.js'));
  return bundleSharedCore(
    {
      io: nodeIo,
      repo: sharedPackageJsonRepository,
      adapter: getBuildAdapter(),
      evaluateModule: (absPath: string) => requireFromWorkspace(absPath),
    },
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
  /**
   * Loads a module by absolute path at build time (Node `require`) and returns its
   * runtime exports, from which a CJS external's named exports are then enumerated.
   * Omitted → no named-export synthesis; externals stay default-only.
   */
  evaluateModule?: ModuleEvaluator;
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

  const folder = fedOptions.packageJson
    ? path.dirname(fedOptions.packageJson)
    : fedOptions.workspaceRoot;

  const contentSignals = linkedContentSignals(
    Object.keys(sharedBundles),
    folder,
    deps.io,
    deps.repo
  );

  const resolvedVersions = installedVersions(Object.keys(sharedBundles), folder, deps.repo);
  // A configured packageInfo short-circuits resolution below, so the key must follow that source —
  // including when it carries no version, where node_modules cannot affect the bundled bytes.
  for (const [key, cfg] of Object.entries(sharedBundles)) {
    if (cfg.packageInfo) resolvedVersions[key] = cfg.packageInfo.version ?? '';
  }

  const checksum = getChecksumCore(
    deps.io,
    sharedBundles,
    fedOptions.dev ? '1' : '0',
    builderVersion,
    config.features,
    contentSignals,
    resolvedVersions
  );

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
    const outName = createOutName(
      deps.io,
      pi,
      configState,
      fedOptions,
      encName,
      contentSignals[pi.packageName] ?? ''
    );

    // Re-emit named exports of CommonJS externals as static exports. ESM externals are left untouched.
    const synthetic =
      deps.evaluateModule && config.features.synthesizeCjsExports
        ? synthesizeCjsNamedExportsEntry(
            deps.io,
            deps.evaluateModule,
            pi,
            fedOptions.federationCache.cachePath,
            outName
          )
        : null;
    return { fileName: synthetic ?? pi.entryPoint, outName };
  });

  const fullOutputPath = path.join(fedOptions.workspaceRoot, fedOptions.outputPath);

  // If we build for the browser and don't remote unused deps from the shared config,
  // we need to exclude typical node libs to avoid compilation issues
  const useDefaultExternalList =
    buildOptions.platform === 'browser' && !config.features.ignoreUnusedDeps;

  const additionalExternals = useDefaultExternalList ? DEFAULT_EXTERNAL_LIST : [];

  let bundleResult: NFBuildAdapterResult[];

  // Separate bundles are built in parallel into one cache, and a chunk that two packages split out
  // alike comes out of both builds under the same name: renaming it by content in one bundle
  // deleted the file the other one was about to read. Each bundle is therefore built and renamed
  // in a folder of its own and moved into the cache afterwards. The folder sits next to the cache,
  // at the same depth, because the `sources` in the emitted maps are relative to it.
  const cachePath = fedOptions.federationCache.cachePath;
  const stagingPath = `${cachePath}.staging-${buildOptions.bundleName}${fedOptions.dev ? '-dev' : ''}`;
  deps.io.removeDir(stagingPath);
  deps.io.mkdirp(stagingPath);

  try {
    await deps.adapter.setup(buildOptions.bundleName, {
      entryPoints,
      tsConfigPath: fedOptions.tsConfig,
      external: [...additionalExternals, ...externals],
      outdir: stagingPath,
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
      stagingPath,
      new Set(entryPoints.map(ep => ep.outName)),
      hashEntries
    );
    applyRenames(bundleResult, entryPoints, renamed);
    moveInto(deps.io, bundleResult, stagingPath, cachePath);
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
  } finally {
    removeStaging(deps.io, stagingPath);
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
  entries: Set<string>,
  hashEntries: Set<string>
): Map<string, string> {
  const sourceFiles = cachedFiles.filter(isSourceFile);

  for (const file of sourceFiles) {
    const filePath = path.join(cachePath, file);
    const sourceCode = io.readText(filePath);
    const edits = collectSpecifierEdits(sourceCode, file);
    io.writeText(filePath, applyEdits(sourceCode, edits));
    // The map esbuild wrote describes the text before the edits; move its columns along.
    shiftSourceMap(io, `${filePath}.map`, sourceCode, edits);
  }

  // Chunks are published under their file name, so the name has to say what the bytes are;
  // entries import them, so they are renamed first and hashed after.
  const renamed = new Map<string, string>();
  const chunkRenames = renameChunksByContentCore(
    io,
    cachePath,
    sourceFiles.filter(file => !entries.has(file)),
    sourceFiles.filter(file => entries.has(file))
  );
  for (const [file, target] of chunkRenames) {
    renamed.set(file, target);
    if (io.exists(path.join(cachePath, `${target}.map`)))
      renamed.set(`${file}.map`, `${target}.map`);
  }

  for (const file of sourceFiles.filter(file => hashEntries.has(file))) {
    const filePath = path.join(cachePath, file);
    const rewritten = io.readText(filePath);
    const hashedName = `${file.split('.')[0]}.${hashEntryContent(io, rewritten)}.js`;
    io.writeText(path.join(cachePath, hashedName), rewritten);
    // Cache hygiene: drop the version-named intermediate (untracked by metadata, so clear() can't reap it).
    io.remove(filePath);
    renamed.set(file, hashedName);
  }

  return renamed;
}

function moveInto(
  io: IoPort,
  bundleResult: NFBuildAdapterResult[],
  from: string,
  to: string
): void {
  for (const br of bundleResult) {
    const target = path.join(to, path.basename(br.fileName));
    const rebased = br.fileName.endsWith('.map') ? rebaseMap(io, br.fileName, from, to) : undefined;
    if (rebased === undefined) io.rename(br.fileName, target);
    else io.writeText(target, rebased);
    br.fileName = target;
  }
}

// A map's sources are relative to the folder it lies in. Both folders sit at the same depth, so
// only a source inside the cache itself, such as a synthesized CommonJS entry, is spelled apart,
// and it is spelled through the cache's own name. Returns the rewritten map, or undefined when
// the file can move as it is.
function rebaseMap(io: IoPort, file: string, from: string, to: string): string | undefined {
  const text = io.readText(file);
  if (!text.includes(`../${path.basename(to)}/`)) return undefined;

  const map = parseMap(text);
  if (!map || map.sourceRoot || !Array.isArray(map.sources)) return undefined;

  let moved = false;
  map.sources = map.sources.map(source => {
    if (typeof source !== 'string' || path.isAbsolute(source) || /^[a-z][\w+.-]*:/i.test(source))
      return source;
    const rebased = toPosix(path.relative(to, path.resolve(from, source)));
    moved ||= rebased !== source;
    return rebased;
  });
  return moved ? JSON.stringify(map) : undefined;
}

// Best effort: the bundle is complete by now, or the error that matters is already on its way.
function removeStaging(io: IoPort, dir: string): void {
  try {
    io.removeDir(dir);
  } catch (e) {
    logger.warn(
      `Could not remove the staging directory '${dir}': ${e instanceof Error ? e.message : e}`
    );
  }
}

function parseMap(text: string): { sources?: unknown[]; sourceRoot?: string } | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
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
  encName: string,
  contentSignal = ''
) {
  const hashBase =
    pi.version +
    '_' +
    pi.entryPoint +
    '_' +
    configState +
    (contentSignal ? '_' + contentSignal : '');
  const hash = hashBuildMetadata(io, hashBase);

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
      ...(shared?.pool && { pool: shared.pool }),
    } as SharedInfo;
  });
}

function getChunkFileNames(chunks: NFBuildAdapterResult[]): string[] {
  return chunks.map(chunk => path.basename(chunk.fileName));
}

// Never a singleton: a chunk belongs to a build, not to a dependency, so nothing downstream can
// tell whether the external it was split out of asked for `singleton: false` or a share scope.
// Its name says what its bytes are, but a name is not enough to share state on.
function addChunksToResult(chunks: NFBuildAdapterResult[], result: SharedInfo[]) {
  for (const item of chunks) {
    const fileName = path.basename(item.fileName);
    result.push({
      singleton: false,
      strictVersion: false,
      version: '0.0.0',
      requiredVersion: '0.0.0',
      packageName: toChunkImport(fileName),
      outFileName: fileName,
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
