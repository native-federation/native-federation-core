import * as path from 'path';
import type { FileReaderPort } from '../domain/utils/io-port.contract.js';
import { nodeIo } from '../utils/io/node-io-adapter.js';
import { normalize } from '../utils/normalize.js';
import { logger } from '../utils/logger.js';

export interface PackageInfo {
  packageName: string;
  entryPoint: string;
  version: string;
  esm: boolean;
}

export interface PartialPackageJson {
  module: string;
  main: string;
}

export type VersionMap = Record<string, string>;

type PackageJsonInfo = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  content: any;
  directory: string;
};

export function getPkgFolder(packageName: string): string {
  const parts = packageName.split('/');
  let folder = parts[0]!;
  if (folder.startsWith('@')) {
    folder += '/' + parts[1];
  }
  return folder;
}

// Reads and caches `package.json` files; the cache is per-instance.
export interface PackageJsonRepository {
  /** package.json files between `project` and `workspace`, nearest first. */
  getPackageJsonFiles(project: string, workspace: string): PackageJsonInfo[];
  /** Nearest `node_modules/<pkg>/package.json` walking up from `projectRoot`. */
  findDepPackageJson(packageName: string, projectRoot: string): string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readJson(filePath: string): any;
  exists(filePath: string): boolean;
}

export function createPackageJsonRepository(
  io: FileReaderPort = nodeIo
): PackageJsonRepository {
  const cache = new Map<string, PackageJsonInfo[]>();

  const readJson = (filePath: string) => JSON.parse(io.readText(filePath));

  function expandFolders(child: string, parent: string): string[] {
    const result: string[] = [];
    parent = normalize(parent, true);
    child = normalize(child, true);

    if (!child.startsWith(parent)) {
      throw new Error(
        `Workspace folder ${parent} needs to be a parent of the project folder ${child}`
      );
    }

    let current = child;
    while (current !== parent) {
      result.push(current);
      const cand = normalize(path.dirname(current), true);
      if (cand === current) break;
      current = cand;
    }
    result.push(parent);
    return result;
  }

  function findPackageJsonFiles(project: string, workspace: string): string[] {
    return expandFolders(project, workspace)
      .map(f => path.join(f, 'package.json'))
      .filter(f => io.exists(f));
  }

  function getPackageJsonFiles(project: string, workspace: string): PackageJsonInfo[] {
    const cacheKey = `${project}**${workspace}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const maps = findPackageJsonFiles(project, workspace).map(f => ({
      content: readJson(f),
      directory: normalize(path.dirname(f), true),
    }));
    cache.set(cacheKey, maps);
    return maps;
  }

  function findDepPackageJson(packageName: string, projectRoot: string): string | null {
    const mainPkgName = getPkgFolder(packageName);
    if (!mainPkgName) throw new Error(`Package.json "${packageName}" is missing`);

    let directory = projectRoot;
    let mainPkgJsonPath = path.join(directory, 'node_modules', mainPkgName, 'package.json');

    while (path.dirname(directory) !== directory) {
      if (io.exists(mainPkgJsonPath)) break;
      directory = normalize(path.dirname(directory), true);
      mainPkgJsonPath = path.join(directory, 'node_modules', mainPkgName, 'package.json');
    }

    if (!io.exists(mainPkgJsonPath)) {
      logger.verbose(
        'No package.json found for ' + packageName + ' in ' + path.dirname(mainPkgJsonPath)
      );
      return null;
    }
    return mainPkgJsonPath;
  }

  return {
    getPackageJsonFiles,
    findDepPackageJson,
    readJson,
    exists: (filePath: string) => io.exists(filePath),
  };
}
