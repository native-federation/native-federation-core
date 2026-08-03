import path from 'path';
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

export const getFilename = (title: string, dev?: boolean) => {
  const devSuffix = dev ? '-dev' : '';
  return `${title}${devSuffix}.meta.json`;
};

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

export const cacheEntryCore = (io: CachePort, pathToCache: string, fileName: string) => {
  const metadataFile = path.join(pathToCache, fileName);
  const readMetadata = (): CacheMetadata => JSON.parse(io.readText(metadataFile));

  return {
    getMetadata: (checksum: string): CacheMetadata | undefined => {
      if (!io.exists(pathToCache) || !io.exists(metadataFile)) return undefined;

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
        const cachedFile = path.join(pathToCache, file);
        if (!io.exists(cachedFile))
          throw new Error(
            `Cached artifact '${file}' recorded in '${metadataFile}' is missing. ` +
              `Delete '${pathToCache}' and rebuild.`
          );
        io.copyFile(cachedFile, path.join(fullOutputPath, file));
      });
    },
    clear: () => {
      if (!io.exists(pathToCache)) {
        io.mkdirp(pathToCache);
        logger.debug(`Creating cache folder '${pathToCache}' for '${fileName}'.`);
        return;
      }
      if (!io.exists(metadataFile)) return;

      logger.debug(`Purging cached bundle '${metadataFile}'.`);

      const cachedResult = readMetadata();
      cachedResult.files.forEach(file => {
        const cachedFile = path.join(pathToCache, file);
        if (io.exists(cachedFile)) io.remove(cachedFile);
      });

      io.remove(metadataFile);
    },
  };
};
