import { getProjectData, type ProjectData } from '@softarc/sheriff-core';
import { cwd } from 'process';
import { getPackageInfo } from './package-info.js';
import { getExternalImports as extractExternalImports } from './get-external-imports.js';
import { type PathToImport } from '../domain/utils/mapped-path.contract.js';
import { type UsedDependencies } from '../domain/utils/used-dependencies.contract.js';
import * as path from 'path';

export function getUsedDependenciesFactory(
  workspaceRoot: string,
  entryPoints?: string[]
): (config: {
  name?: string;
  exposes?: Record<string, string>;
  sharedMappings: PathToImport;
}) => UsedDependencies {
  return config => {
    if (!entryPoints || entryPoints.length < 1) entryPoints = Object.values(config.exposes ?? {});
    const fileInfos = Object.values(config.exposes ?? entryPoints ?? []).reduce(
      (acc, entryPoint) => ({
        ...acc,
        ...getProjectData(entryPoint, cwd(), {
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
      external: addTransientDeps(usedPackageNames, workspaceRoot),
      internal: resolveUsedMappings(fileInfos, workspaceRoot, config.sharedMappings),
    };
  };
}

function addTransientDeps(packages: Set<string>, workspaceRoot: string) {
  const packagesAndPeers = new Set<string>([...packages]);
  const discovered = new Set<string>(packagesAndPeers);
  const stack = [...packagesAndPeers];

  while (stack.length > 0) {
    const dep = stack.pop();

    if (!dep) {
      continue;
    }

    const pInfo = getPackageInfo(dep, workspaceRoot);

    if (!pInfo) {
      continue;
    }

    const peerDeps = extractExternalImports(pInfo.entryPoint);

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

function isSharedMapping(filePath: string, sharedMappings: PathToImport): boolean {
  for (const sharedPath of Object.keys(sharedMappings)) {
    const asteriskIndex = sharedPath.indexOf('*');
    if (asteriskIndex !== -1) {
      const prefix = sharedPath.substring(0, asteriskIndex);
      if (filePath.startsWith(prefix)) return true;
    } else if (filePath.startsWith(sharedPath + path.sep) || filePath === sharedPath) {
      return true;
    }
  }
  return false;
}

function matchMapping(filePath: string, sharedMappings: PathToImport): string | null {
  for (const [sharedPath, sharedImport] of Object.entries(sharedMappings)) {
    const asteriskIndex = sharedPath.indexOf('*');
    if (asteriskIndex !== -1) {
      const prefix = sharedPath.substring(0, asteriskIndex);
      const suffix = sharedPath.substring(asteriskIndex + 1);
      if (!filePath.startsWith(prefix)) continue;
      if (suffix && !filePath.includes(suffix)) continue;
      const captured = suffix
        ? filePath.slice(prefix.length, filePath.indexOf(suffix, prefix.length))
        : filePath.slice(prefix.length);
      return sharedImport.replace('*', toImportPath(captured));
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
  const normalized = withoutExt.replace(/\\/g, '/');
  return normalized.endsWith('/index') ? normalized.slice(0, -6) : normalized;
}
