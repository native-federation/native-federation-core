import { getProjectData as sheriffGetProjectData, type ProjectData } from '@softarc/sheriff-core';
import { cwd } from 'process';
import { defaultRepo, getPackageInfo } from '../package-resolution/package-info.js';
import { type PackageJsonRepository } from '../package-resolution/package-json-repository.js';
import { getExternalImportsCore } from './get-external-imports.js';
import { nodeIo } from '../utils/io/node-io-adapter.js';
import { type FileReaderPort } from '../domain/utils/io-port.contract.js';
import { type PathToImport } from '../domain/utils/mapped-path.contract.js';
import { type UsedDependencies } from '../domain/utils/used-dependencies.contract.js';
import { type ExposeEntry } from '../domain/config/federation-config.contract.js';
import { parseWildcard, substituteWildcard, toPosix } from '../utils/path-patterns.js';
import * as path from 'path';

export type GetProjectData = (
  entryPoint: string,
  cwd: string,
  options: { includeExternalLibraries: boolean }
) => ProjectData;

export interface UsedDependenciesDeps {
  io: FileReaderPort;
  repo: PackageJsonRepository;
  getProjectData: GetProjectData;
}

const defaultDeps: UsedDependenciesDeps = {
  io: nodeIo,
  repo: defaultRepo,
  getProjectData: sheriffGetProjectData,
};

type UsedDependenciesConfig = {
  name?: string;
  exposes?: Record<string, ExposeEntry>;
  sharedMappings: PathToImport;
};

export function getUsedDependenciesFactory(
  workspaceRoot: string,
  fallbackEntryPoints?: string[]
): (config: UsedDependenciesConfig) => UsedDependencies {
  return getUsedDependenciesFactoryCore(defaultDeps, workspaceRoot, fallbackEntryPoints);
}

export function getUsedDependenciesFactoryCore(
  deps: UsedDependenciesDeps,
  workspaceRoot: string,
  fallbackEntryPoints?: string[]
): (config: UsedDependenciesConfig) => UsedDependencies {
  return config => {
    let entryPoints: string[] | undefined = Object.values(config.exposes ?? {}).map(e => e.file);
    if (entryPoints.length < 1) entryPoints = fallbackEntryPoints;

    if (!entryPoints || entryPoints.length < 1)
      throw new Error(
        '[removeUnusedDeps] native-federation is missing an entryPoint! You can set it using the Federation options or by setting an exposed module in the Federation config file.'
      );
    const fileInfos = Object.values(entryPoints ?? []).reduce(
      (acc, entryPoint) => ({
        ...acc,
        ...deps.getProjectData(entryPoint, cwd(), {
          includeExternalLibraries: true,
        }),
      }),
      {} as ProjectData
    );

    const usedPackageNames = new Set<string>();
    for (const fileInfo of Object.values(fileInfos)) {
      for (const pckg of [
        ...(fileInfo?.externalLibraries || []),
        ...(fileInfo?.unresolvedImports || []),
      ]) {
        usedPackageNames.add(pckg);
      }
    }

    return {
      external: addTransientDeps(usedPackageNames, workspaceRoot, deps),
      internal: resolveUsedMappings(fileInfos, workspaceRoot, config.sharedMappings),
    };
  };
}

function addTransientDeps(
  packages: Set<string>,
  workspaceRoot: string,
  deps: UsedDependenciesDeps
) {
  const packagesAndPeers = new Set<string>([...packages]);
  const discovered = new Set<string>(packagesAndPeers);
  const stack = [...packagesAndPeers];

  while (stack.length > 0) {
    const dep = stack.pop();

    if (!dep) {
      continue;
    }

    const pInfo = getPackageInfo(dep, workspaceRoot, deps.repo);

    if (!pInfo) {
      continue;
    }

    const peerDeps = getExternalImportsCore(deps.io, pInfo.entryPoint);

    for (const peerDep of peerDeps) {
      if (!discovered.has(peerDep)) {
        discovered.add(peerDep);
        stack.push(peerDep);
        packagesAndPeers.add(peerDep);
      }
    }
  }
  return packagesAndPeers;
}

function resolveUsedMappings(
  fileInfos: ProjectData,
  workspaceRoot: string,
  sharedMappings: PathToImport
): PathToImport {
  const usedMappings: PathToImport = {};

  for (const fileName of Object.keys(fileInfos)) {
    const fullFileName = path.join(workspaceRoot, fileName);

    if (isSharedMapping(fullFileName, sharedMappings)) continue;

    const fileInfo = fileInfos[fileName];
    if (!fileInfo) continue;

    // Check if any of this file's imports land in a shared mapping
    for (const imp of fileInfo.imports ?? []) {
      const fullImport = path.join(workspaceRoot, imp);
      const match = matchMapping(fullImport, sharedMappings);
      if (match) usedMappings[fullImport] = match;
    }
  }

  return usedMappings;
}

export function isSharedMapping(filePath: string, sharedMappings: PathToImport): boolean {
  for (const sharedPath of Object.keys(sharedMappings)) {
    const { prefix, hasWildcard } = parseWildcard(sharedPath);
    if (hasWildcard) {
      if (filePath.startsWith(prefix)) return true;
    } else if (filePath.startsWith(sharedPath + path.sep) || filePath === sharedPath) {
      return true;
    }
  }
  return false;
}

export function matchMapping(filePath: string, sharedMappings: PathToImport): string | null {
  for (const [sharedPath, sharedImport] of Object.entries(sharedMappings)) {
    const { prefix, suffix, hasWildcard } = parseWildcard(sharedPath);
    if (hasWildcard) {
      if (!filePath.startsWith(prefix)) continue;
      if (suffix && !filePath.includes(suffix)) continue;
      // First-occurrence capture: the path may contain the suffix more than once.
      const captured = suffix
        ? filePath.slice(prefix.length, filePath.indexOf(suffix, prefix.length))
        : filePath.slice(prefix.length);
      return substituteWildcard(sharedImport, toImportPath(captured));
    } else if (filePath === sharedPath || isIndexOf(filePath, sharedPath)) {
      return sharedImport;
    }
  }
  return null;
}

/**
 * Detect if it's a barrel file which is inferred by typescript
 */
const INDEX_PATTERN = /\/index\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

function isIndexOf(filePath: string, dirPath: string): boolean {
  return filePath.startsWith(dirPath + path.sep) && INDEX_PATTERN.test(filePath);
}

function toImportPath(filePath: string): string {
  const withoutExt = filePath.replace(/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/, '');
  const normalized = toPosix(withoutExt);
  return normalized.endsWith('/index') ? normalized.slice(0, -6) : normalized;
}
