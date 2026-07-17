import path from 'path';
import type { NormalizedExternalConfig } from '../../domain/config/external-config.contract.js';
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
  synthesizeCjsExports = true,
  contentSignals: Record<string, string> = {}
): string =>
  getChecksumCore(nodeIo, shared, dev, builderVersion, synthesizeCjsExports, contentSignals);

export const getChecksumCore = (
  hash: HashPort,
  shared: Record<string, NormalizedExternalConfig>,
  dev: '1' | '0',
  builderVersion = '',
  synthesizeCjsExports = true,
  // Per-key content signal, set only for symlinked deps; empty map => version-only hash.
  contentSignals: Record<string, string> = {}
): string => {
  const denseExternals = Object.keys(shared)
    .sort()
    .reduce((clean, external) => {
      const version = shared[external]!.version ? `@${shared[external]!.version}` : '';
      const signal = contentSignals[external] ? `#${contentSignals[external]}` : '';
      return clean + ':' + external + version + signal;
    }, 'deps');

  const cjs = synthesizeCjsExports ? '1' : '0';
  return hash
    .hash('sha256', denseExternals + `:dev=${dev}:builder=${builderVersion}:cjs=${cjs}`)
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
        const distFileName = path.join(fullOutputPath, file);
        if (io.exists(cachedFile)) io.copyFile(cachedFile, distFileName);
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
