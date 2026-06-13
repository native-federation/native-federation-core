import * as path from 'path';
import * as fs from 'fs';
import JSON5 from 'json5';
import type { PathToImport } from '../domain/utils/mapped-path.contract.js';

/**
 * Will return user defined and tsconfig defined paths including their imports, might contain wildcards
 * @param param0
 * @returns
 */
export function getRawMappedPaths(
  rootTsConfigPath: string,
  configuredSharedMappings?: string[],
  rootPath?: string
): PathToImport {
  const mappedPaths: PathToImport = {};

  if (!path.isAbsolute(rootTsConfigPath)) {
    throw new Error('SharedMappings.register: tsConfigPath needs to be an absolute path!');
  }

  if (!rootPath) {
    rootPath = path.normalize(path.dirname(rootTsConfigPath));
  }
  const shareAll = !configuredSharedMappings;

  if (!configuredSharedMappings) {
    configuredSharedMappings = [];
  }

  const tsConfig = JSON5.parse(fs.readFileSync(rootTsConfigPath, { encoding: 'utf-8' }));

  const mappings = tsConfig?.compilerOptions?.paths;

  if (!mappings) {
    return mappedPaths;
  }

  for (const key in mappings) {
    const libPath = path.normalize(path.join(rootPath, mappings[key][0]));

    if (configuredSharedMappings.includes(key) || shareAll) {
      mappedPaths[libPath] = key;
    }
  }

  return mappedPaths;
}
