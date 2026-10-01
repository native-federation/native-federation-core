import path from 'path';
import { fileURLToPath } from 'url';
import type { NormalizedExternalConfig } from '../../domain/config/external-config.contract.js';
import type { NormalizedFederationConfig } from '../../domain/config/federation-config.contract.js';
import type {
  ChunkInfo,
  IntegrityMap,
  SharedInfo,
} from '../../domain/core/federation-info.contract.js';
import type {
  FileReaderPort,
  FileWriterPort,
  HashPort,
} from '../../domain/utils/io-port.contract.js';
import { nodeIo } from '../../utils/io/node-io-adapter.js';
import { logger } from '../../utils/logger.js';

export const getDefaultCachePath = (workspaceRoot: string) =>
  path.join(workspaceRoot, 'node_modules/.cache/native-federation');

const getCacheKey = (title: string, dev?: boolean) => `${title}${dev ? '-dev' : ''}`;

export const getFilename = (title: string, dev?: boolean) => `${getCacheKey(title, dev)}.meta.json`;

// Each bundle owns a folder of its own: content-named chunks collide across bundles, and a
// bundle renaming or clearing its copy must not take another bundle's with it (core#154).
const getBundleDir = (cachePath: string, title: string, dev?: boolean) =>
  path.join(cachePath, getCacheKey(title, dev));

export const getChecksum = (
  shared: Record<string, NormalizedExternalConfig>,
  dev: '1' | '0',
  builderVersion = '',
  features: FeatureFlags = {},
  contentSignals: Record<string, string> = {},
  resolvedVersions: Record<string, string> = {}
): string =>
  getChecksumCore(nodeIo, shared, dev, builderVersion, features, contentSignals, resolvedVersions);

export type FeatureFlags = Partial<NormalizedFederationConfig['features']>;

const featureState = (features: FeatureFlags): string =>
  Object.entries(features)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([flag, on]) => `${flag}=${on ? '1' : '0'}`)
    .join(',');

// Fields `buildResult` copies from the config straight into SharedInfo, so they ship in
// remoteEntry.json. A cache hit replays the recorded externals verbatim, so a change to any of
// them must miss — otherwise the runtime negotiates versions against stale metadata.
const SHARED_INFO_FIELDS = [
  'requiredVersion',
  'singleton',
  'strictVersion',
  'shareScope',
  'pool',
] as const;

// JSON-encoded so a value containing a delimiter cannot forge one; fixed field order, so no sort.
const sharedInfoState = (config: NormalizedExternalConfig): string => {
  const values = SHARED_INFO_FIELDS.map(field => config[field] ?? null);
  return values.every(value => value === null) ? '' : `!${JSON.stringify(values)}`;
};

export const getChecksumCore = (
  hash: HashPort,
  shared: Record<string, NormalizedExternalConfig>,
  dev: '1' | '0',
  builderVersion = '',
  features: FeatureFlags = {},
  // Per-key content signal, set only for symlinked deps; empty map => version-only hash.
  contentSignals: Record<string, string> = {},
  // Per-key installed version — the only version that can change the bundled bytes, so it wins
  // outright. An omitted map falls back to the declared range for every key, reproducing the
  // pre-installed-version checksum byte for byte.
  resolvedVersions: Record<string, string> = {}
): string => {
  const denseExternals = Object.keys(shared)
    .sort()
    .reduce((clean, external) => {
      const installed = resolvedVersions[external];
      const declared = shared[external]!.version;

      const version = installed ? `~${installed}` : declared ? `@${declared}` : '';
      const signal = contentSignals[external] ? `#${contentSignals[external]}` : '';
      return clean + ':' + external + version + sharedInfoState(shared[external]!) + signal;
    }, 'deps');

  return hash
    .hash(
      'sha256',
      denseExternals + `:dev=${dev}:builder=${builderVersion}:features=${featureState(features)}`
    )
    .hex();
};

export type CacheMetadata = {
  checksum: string;
  externals: SharedInfo[];
  chunks?: ChunkInfo;
  integrity?: IntegrityMap;
  files: string[];
};

type CachePort = FileReaderPort & FileWriterPort;

export const cacheEntryCore = (
  io: CachePort,
  pathToCache: string,
  bundleName: string,
  dev?: boolean
) => {
  const metadataFile = path.join(pathToCache, getFilename(bundleName, dev));
  const dir = getBundleDir(pathToCache, bundleName, dev);
  const readMetadata = (): CacheMetadata => JSON.parse(io.readText(metadataFile));

  return {
    dir,
    getMetadata: (checksum: string): CacheMetadata | undefined => {
      if (!io.exists(metadataFile)) return undefined;

      const cachedResult = readMetadata();
      if (cachedResult.checksum !== checksum) return undefined;
      return cachedResult;
    },
    persist: (payload: CacheMetadata) => {
      io.writeText(metadataFile, JSON.stringify(payload));
    },
    copyFiles: (fullOutputPath: string) => {
      if (!io.exists(metadataFile))
        throw new Error('Error copying artifacts to dist, metadata file could not be found.');

      const cachedResult = readMetadata();
      io.mkdirp(fullOutputPath);

      cachedResult.files.forEach(file => {
        const cachedFile = path.join(dir, file);
        if (!io.exists(cachedFile))
          throw new Error(
            `Cached artifact '${file}' recorded in '${metadataFile}' is missing. ` +
              `Delete '${pathToCache}' and rebuild.`
          );
        io.copyFile(cachedFile, path.join(fullOutputPath, file));
      });
    },
    clear: () => {
      logger.debug(`Purging cached bundle '${dir}'.`);
      // Metadata first: an interrupted clear must not leave metadata listing files that are gone.
      if (io.exists(metadataFile)) io.remove(metadataFile);
      io.removeDir(dir);
      io.mkdirp(dir);
    },
  };
};

const STAMP_FILE = '.nf-cache.json';
// Bump when the on-disk layout changes within a minor.
const CACHE_LAYOUT = 2;

type CacheStamp = { layout: number; version: string };

const minorOf = (version: string) => /^\d+\.\d+/.exec(version)?.[0] ?? version;

const readStamp = (io: CachePort, file: string): CacheStamp | undefined => {
  if (!io.exists(file)) return undefined;
  try {
    return JSON.parse(io.readText(file));
  } catch {
    return undefined;
  }
};

// Patch releases already miss per bundle through the checksum; a minor may change the layout,
// which a checksum cannot see, so the whole project cache goes. A cache without a stamp
// predates per-bundle folders and is purged the same way.
export const prepareCacheCore = (io: CachePort, cachePath: string, builderVersion: string) => {
  const stampFile = path.join(cachePath, STAMP_FILE);
  const stamp = readStamp(io, stampFile);
  if (stamp?.layout === CACHE_LAYOUT && minorOf(stamp.version) === minorOf(builderVersion)) return;

  if (io.exists(cachePath)) {
    logger.debug(`Purging cache folder '${cachePath}' written by another builder version.`);
    io.removeDir(cachePath);
  }
  io.mkdirp(cachePath);
  io.writeText(stampFile, JSON.stringify({ layout: CACHE_LAYOUT, version: builderVersion }));
};

export const prepareCache = (cachePath: string) =>
  prepareCacheCore(
    nodeIo,
    cachePath,
    parseBuilderVersion(readBuilderPackageJson(nodeIo, fileURLToPath(import.meta.url)))
  );

// Walk up to the nearest package.json: the file's depth differs across src/dist/test layouts.
export function readBuilderPackageJson(io: FileReaderPort, fromFile: string): string {
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
