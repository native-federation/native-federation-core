import * as path from 'path';
import JSON5 from 'json5';
import { nodeIo } from '../utils/io/node-io-adapter.js';
import type { FileReaderPort } from '../domain/utils/io-port.contract.js';
import type { PathToImport } from '../domain/utils/mapped-path.contract.js';

/**
 * Will return user defined and tsconfig defined paths including their imports, might contain wildcards
 */
export function getRawMappedPaths(
  rootTsConfigPath: string,
  configuredSharedMappings?: string[],
  rootPath?: string
): PathToImport {
  return getRawMappedPathsCore(nodeIo, rootTsConfigPath, configuredSharedMappings, rootPath);
}

export function getRawMappedPathsCore(
  io: FileReaderPort,
  rootTsConfigPath: string,
  configuredSharedMappings?: string[],
  rootPath?: string
): PathToImport {
  const mappedPaths: PathToImport = {};

  if (!path.isAbsolute(rootTsConfigPath)) {
    throw new Error('SharedMappings.register: tsConfigPath needs to be an absolute path!');
  }

  const basePath = rootPath ?? path.normalize(path.dirname(rootTsConfigPath));
  const shareAll = !configuredSharedMappings;
  const sharedMappings = configuredSharedMappings ?? [];

  const tsConfig = JSON5.parse(io.readText(rootTsConfigPath));

  const mappings = tsConfig?.compilerOptions?.paths;

  if (!mappings) {
    return mappedPaths;
  }

  for (const key in mappings) {
    const libPath = path.normalize(path.join(basePath, mappings[key][0]));

    if (shareAll || sharedMappings.includes(key)) {
      mappedPaths[libPath] = key;
    }
  }

  return mappedPaths;
}
