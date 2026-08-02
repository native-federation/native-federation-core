import * as path from 'path';
import JSON5 from 'json5';
import { nodeIo } from '../utils/io/node-io-adapter.js';
import type { FileReaderPort } from '../domain/utils/io-port.contract.js';
import type { PathToImport } from '../domain/utils/mapped-path.contract.js';
import type {
  SharedMappingConfigs,
  SharedMappingEntry,
} from '../domain/config/federation-config.contract.js';
import { matchesWildcard } from '../utils/path-patterns.js';

export interface RawMappedPaths {
  paths: PathToImport;
  configs: SharedMappingConfigs;
}

/**
 * Will return user defined and tsconfig defined paths including their imports, might contain wildcards
 */
export function getRawMappedPaths(
  rootTsConfigPath: string,
  configuredSharedMappings?: SharedMappingEntry[],
  rootPath?: string
): RawMappedPaths {
  return getRawMappedPathsCore(nodeIo, rootTsConfigPath, configuredSharedMappings, rootPath);
}

export function getRawMappedPathsCore(
  io: FileReaderPort,
  rootTsConfigPath: string,
  configuredSharedMappings?: SharedMappingEntry[],
  rootPath?: string
): RawMappedPaths {
  const mappedPaths: PathToImport = {};

  if (!path.isAbsolute(rootTsConfigPath)) {
    throw new Error('SharedMappings.register: tsConfigPath needs to be an absolute path!');
  }

  const basePath = rootPath ?? path.normalize(path.dirname(rootTsConfigPath));
  const shareAll = !configuredSharedMappings;
  const { patterns, configs } = flattenEntries(configuredSharedMappings ?? []);

  const tsConfig = JSON5.parse(io.readText(rootTsConfigPath));

  const mappings = tsConfig?.compilerOptions?.paths;

  if (!mappings) {
    return { paths: mappedPaths, configs };
  }

  for (const key in mappings) {
    const libPath = path.normalize(path.join(basePath, mappings[key][0]));

    if (shareAll || patterns.some(pattern => matchesWildcard(key, pattern))) {
      mappedPaths[libPath] = key;
    }
  }

  return { paths: mappedPaths, configs };
}

function flattenEntries(entries: SharedMappingEntry[]): {
  patterns: string[];
  configs: SharedMappingConfigs;
} {
  const patterns: string[] = [];
  const configs: SharedMappingConfigs = {};

  for (const entry of entries) {
    if (typeof entry === 'string') {
      patterns.push(entry);
      continue;
    }

    const [keys, config] = entry;
    for (const key of keys) {
      patterns.push(key);
      // Declaration order decides: a later entry never overrides an earlier one.
      if (!(key in configs)) configs[key] = config;
    }
  }

  return { patterns, configs };
}
