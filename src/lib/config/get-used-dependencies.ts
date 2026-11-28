import { getProjectData as sheriffGetProjectData, type ProjectData } from '@softarc/sheriff-core';
import { sharedPackageJsonRepository } from '../utils/package/package-info.js';
import { resolveInstalledPackageInfo } from '../utils/package/entry-point-resolver.js';
import { NOT_EXPORTED } from '../utils/package/exports-resolver.js';
import { normalize } from '../utils/normalize.js';
import {
  type PackageInfo,
  type PackageJsonRepository,
} from '../domain/utils/package-json.contract.js';
import { getExternalImportsCore } from './get-external-imports.js';
import { nodeIo } from '../utils/io/node-io-adapter.js';
import { type FileReaderPort } from '../domain/utils/io-port.contract.js';
import { type PathToImport } from '../domain/utils/mapped-path.contract.js';
import { type UsedDependencies } from '../domain/utils/used-dependencies.contract.js';
import { type ExposeEntry } from '../domain/config/federation-config.contract.js';
import { isSharedMapping, matchMapping } from './match-mapping.js';
import { isNonBarrelImport } from './validate-mappings.js';
import { logger } from '../utils/logger.js';
import { resolveModuleFile } from '../utils/module-file.js';
import * as path from 'path';
import * as ts from 'typescript';

type GetProjectData = (
  entryPoint: string,
  cwd: string,
  options: { includeExternalLibraries: boolean; includeRawImports: boolean }
) => ProjectData;

export interface UsedDependenciesDeps {
  io: FileReaderPort;
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
  shared?: Record<string, { platform: 'browser' | 'node' }>;
  platform?: 'browser' | 'node';
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
    const entryFiles = entryPoints.map(entryPoint =>
      resolveEntryPoint(deps.io, workspaceRoot, entryPoint)
    );

    // Rooted at workspaceRoot because its root-relative results are re-joined onto it below.
    const fileInfos = entryFiles.reduce(
      (acc, entryFile) => ({
        ...acc,
        ...deps.getProjectData(path.relative(workspaceRoot, entryFile), workspaceRoot, {
          includeExternalLibraries: true,
          includeRawImports: true,
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
      external: addTransientDeps(
        usedPackageNames,
        workspaceRoot,
        deps,
        config.shared ?? {},
        config.platform ?? 'browser'
      ),
      ...resolveUsedMappings(fileInfos, workspaceRoot, config.sharedMappings, deps.io),
    };
  };
}

// The analysis needs an existing file, while the bundler also accepts an extensionless path or
// a folder.
function resolveEntryPoint(io: FileReaderPort, workspaceRoot: string, entryPoint: string): string {
  const absolute = path.resolve(workspaceRoot, entryPoint);
  const resolved = resolveModuleFile(io, absolute);
  if (!resolved) {
    throw new Error(
      `[removeUnusedDeps] Entry point '${entryPoint}' does not exist: no file, no file with a ` +
        `module extension and no folder with an index file at ${absolute}.`
    );
  }
  return resolved;
}

interface PendingPackage {
  name: string;
  importer?: string;
}

function addTransientDeps(
  packages: Set<string>,
  workspaceRoot: string,
  deps: UsedDependenciesDeps,
  shared: Record<string, { platform: 'browser' | 'node' }>,
  configPlatform: 'browser' | 'node'
) {
  const packagesAndPeers = new Set<string>(packages);
  const scanned = new Set<string>();
  const stack: PendingPackage[] = [...packages].map(name => ({ name }));

  while (stack.length > 0) {
    const { name, importer } = stack.pop()!;

    // see docs/architecture/package-resolution.md#which-install-the-unused-dependency-scan-reads
    const sharedConfig = shared[name];
    const found = findInstalledPackage(
      name,
      sharedConfig ? undefined : importer,
      workspaceRoot,
      sharedConfig?.platform ?? configPlatform,
      deps
    );
    if (!found) continue;

    const entryPoint = deps.io.realpath(found.info.entryPoint);
    if (scanned.has(entryPoint)) continue;
    scanned.add(entryPoint);

    for (const peerDep of getExternalImportsCore(deps.io, found.info.entryPoint)) {
      packagesAndPeers.add(peerDep);
      stack.push({ name: peerDep, importer: found.directory });
    }
  }
  return packagesAndPeers;
}

function findInstalledPackage(
  name: string,
  importer: string | undefined,
  workspaceRoot: string,
  platform: 'browser' | 'node',
  deps: UsedDependenciesDeps
): { info: PackageInfo; directory: string } | null {
  const root = normalize(workspaceRoot, true);
  for (const from of importer ? [importer, root] : [root]) {
    const pkgJsonPath = deps.repo.findDepPackageJson(name, from);
    if (!pkgJsonPath) continue;
    const info = resolveInstalledPackageInfo(deps.repo, name, pkgJsonPath, platform);
    if (!info || info === NOT_EXPORTED) return null;
    return { info, directory: deps.io.realpath(path.dirname(pkgJsonPath)) };
  }
  return null;
}

function resolveUsedMappings(
  fileInfos: ProjectData,
  workspaceRoot: string,
  sharedMappings: PathToImport,
  io: FileReaderPort
): Pick<UsedDependencies, 'internal' | 'mappingImports'> {
  const usedMappings: PathToImport = {};
  const matchesIgnoringCase = createCaseInsensitiveMatcher(sharedMappings);
  const caseOnlyMisses = new Set<string>();
  const specifiersInMappings = new Map<string, string>();

  for (const fileName of Object.keys(fileInfos)) {
    const fullFileName = path.join(workspaceRoot, fileName);

    const fileInfo = fileInfos[fileName];
    if (!fileInfo) continue;

    const inMapping = isSharedMapping(fullFileName, sharedMappings);
    if (inMapping) {
      for (const s of bareSpecifiers(fileInfo, fullFileName, io))
        if (!specifiersInMappings.has(s)) specifiersInMappings.set(s, fileName);
    }

    for (const imp of fileInfo.imports ?? []) {
      const fullImport = path.join(workspaceRoot, imp);
      const match = matchMapping(fullImport, sharedMappings);
      if (match) {
        // Inside a mapping, relative imports are the lib's own bundled code; only a barrel
        // imported by specifier is another entry point that must be published (core#135).
        const bySpecifier =
          !isNonBarrelImport(match) && !!fileInfo.rawImports?.[imp]?.includes(match);
        if (!inMapping || bySpecifier) usedMappings[fullImport] = match;
      } else if (!inMapping && matchesIgnoringCase(fullImport)) caseOnlyMisses.add(fullImport);
    }
  }

  warnOnCaseOnlyMisses(caseOnlyMisses);

  return { internal: usedMappings, mappingImports: specifiersInMappings };
}

function bareSpecifiers(
  fileInfo: ProjectData[string],
  filePath: string,
  io: FileReaderPort
): string[] {
  // sheriff drops specifiers ending in its ignoreFileExtensions (json, css, svg, ...) before
  // recording them, so a subpath like '@org/ui/config.json' only shows up in the source itself.
  const scanned = io.isFile(filePath)
    ? ts.preProcessFile(io.readText(filePath)).importedFiles.map(f => f.fileName)
    : [];
  return [
    ...new Set([
      ...Object.values(fileInfo.rawImports ?? {}).flat(),
      ...scanned,
      ...(fileInfo.externalLibraries ?? []),
      ...(fileInfo.unresolvedImports ?? []),
    ]),
  ].filter(s => !s.startsWith('.') && !path.isAbsolute(s));
}

/**
 * Diagnosis only: never decides whether a mapping is used. Lower-casing the set once keeps it
 * cheap enough for every unmatched import, which is what makes a partial mismatch visible.
 */
function createCaseInsensitiveMatcher(sharedMappings: PathToImport): (filePath: string) => boolean {
  const lowerCased = Object.fromEntries(
    Object.entries(sharedMappings).map(([sharedPath, sharedImport]) => [
      sharedPath.toLowerCase(),
      sharedImport,
    ])
  );

  return filePath => matchMapping(filePath.toLowerCase(), lowerCased) !== null;
}

/**
 * A case-only hit means one directory spelled two ways: the workspace root (see
 * utils/disk-case.ts), or a mis-cased tsconfig `paths` value that TypeScript resolves anyway on a
 * case-insensitive filesystem. `removeUnusedDeps` covers all-pruned; only this sees a partial one.
 */
function warnOnCaseOnlyMisses(misses: ReadonlySet<string>): void {
  if (misses.size === 0) return;

  logger.warn(
    `${misses.size} import(s) match a shared mapping only when case is ignored, so those ` +
      `libraries were pruned from remoteEntry.json:\n` +
      [...misses].map(miss => `  - ${miss}`).join('\n')
  );
}
