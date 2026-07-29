import { getProjectData as sheriffGetProjectData, type ProjectData } from '@softarc/sheriff-core';
import { cwd } from 'process';
import { sharedPackageJsonRepository, getPackageInfo } from '../utils/package/package-info.js';
import { type PackageJsonRepository } from '../domain/utils/package-json.contract.js';
import { getExternalImportsCore } from './get-external-imports.js';
import { nodeIo } from '../utils/io/node-io-adapter.js';
import {
  type FileReaderPort,
  type FileWriterPort,
  type HashPort,
} from '../domain/utils/io-port.contract.js';
import { getDefaultCachePath } from '../core/cache/cache-persistence.js';
import { type PathToImport } from '../domain/utils/mapped-path.contract.js';
import { type UsedDependencies } from '../domain/utils/used-dependencies.contract.js';
import { type ExposeEntry } from '../domain/config/federation-config.contract.js';
import { parseWildcard, substituteWildcard, toPosix } from '../utils/path-patterns.js';
import * as path from 'path';

type GetProjectData = (
  entryPoint: string,
  cwd: string,
  options: { includeExternalLibraries: boolean }
) => ProjectData;

export interface UsedDependenciesDeps {
  io: FileReaderPort & FileWriterPort & HashPort;
  repo: PackageJsonRepository;
  getProjectData: GetProjectData;
}

const defaultDeps: UsedDependenciesDeps = {
  io: nodeIo,
  repo: sharedPackageJsonRepository,
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

const TRANSIENT_DEPS_CACHE_FILE = 'used-transient-deps.meta.json';

const transientDepsCacheFile = (workspaceRoot: string) =>
  path.join(getDefaultCachePath(workspaceRoot), TRANSIENT_DEPS_CACHE_FILE);

interface TransientDepsCacheEntry {
  checksum: string;
  /** Version of every package the previous expansion visited. */
  versions: Record<string, string | null>;
  result: string[];
}

/**
 * Expanding the peer graph parses the entry point of every visited package,
 * which dominates the cost of resolving used dependencies. The expansion is a
 * pure function of the input package names and the contents of the visited
 * packages, so it is cached across builds.
 *
 * Validation re-reads only the visited package versions — orders of magnitude
 * cheaper than re-parsing their entry points — so a dependency upgrade still
 * invalidates the entry. The cache lives under `node_modules/.cache`, so a
 * reinstall drops it as well.
 */
function readCachedTransientDeps(
  deps: UsedDependenciesDeps,
  workspaceRoot: string,
  checksum: string
): Set<string> | undefined {
  const file = transientDepsCacheFile(workspaceRoot);
  if (!deps.io.exists(file)) {
    return undefined;
  }

  let cached: TransientDepsCacheEntry;
  try {
    cached = JSON.parse(deps.io.readText(file)) as TransientDepsCacheEntry;
  } catch {
    return undefined;
  }

  if (cached.checksum !== checksum || !cached.result || !cached.versions) {
    return undefined;
  }

  for (const [name, version] of Object.entries(cached.versions)) {
    if ((getPackageInfo(name, workspaceRoot, deps.repo)?.version ?? null) !== version) {
      return undefined;
    }
  }

  return new Set(cached.result);
}

function addTransientDeps(
  packages: Set<string>,
  workspaceRoot: string,
  deps: UsedDependenciesDeps
) {
  const checksum = deps.io.hash('sha256', [...packages].sort().join(':')).hex();
  const cached = readCachedTransientDeps(deps, workspaceRoot, checksum);
  if (cached) {
    return cached;
  }

  const packagesAndPeers = new Set<string>([...packages]);
  const discovered = new Set<string>(packagesAndPeers);
  const stack = [...packagesAndPeers];
  const versions: Record<string, string | null> = {};

  while (stack.length > 0) {
    const dep = stack.pop();

    if (!dep) {
      continue;
    }

    const pInfo = getPackageInfo(dep, workspaceRoot, deps.repo);

    if (!pInfo) {
      continue;
    }

    versions[dep] = pInfo.version ?? null;

    const peerDeps = getExternalImportsCore(deps.io, pInfo.entryPoint);

    for (const peerDep of peerDeps) {
      if (!discovered.has(peerDep)) {
        discovered.add(peerDep);
        stack.push(peerDep);
        packagesAndPeers.add(peerDep);
      }
    }
  }
  try {
    deps.io.mkdirp(getDefaultCachePath(workspaceRoot));
    deps.io.writeText(
      transientDepsCacheFile(workspaceRoot),
      JSON.stringify({ checksum, versions, result: [...packagesAndPeers] })
    );
  } catch {
    // A cache that cannot be written must never fail the build.
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
