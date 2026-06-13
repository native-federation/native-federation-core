import * as path from 'path';
import type { FileReaderPort } from '../../domain/utils/io-port.contract.js';
import type {
  PackageJsonInfo,
  PackageJsonRepository,
} from '../../domain/utils/package-json.contract.js';
import { nodeIo } from './node-io-adapter.js';
import { normalize } from '../normalize.js';
import { logger } from '../logger.js';

export function getPkgFolder(packageName: string): string {
  const parts = packageName.split('/');
  let folder = parts[0]!;
  if (folder.startsWith('@')) {
    folder += '/' + parts[1];
  }
  return folder;
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

export const sharedPackageJsonRepository = createPackageJsonRepository();
