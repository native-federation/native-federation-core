import * as path from 'path';
import { cwd } from 'process';
import { getConfigContext } from './configuration-context.js';
import { nodeIo } from '../utils/io/node-io-adapter.js';
import type { FileReaderPort } from '../domain/utils/io-port.contract.js';
import { toDiskCaseCore } from '../utils/disk-case.js';
import { logger } from '../utils/logger.js';

export function findRootTsConfigJson(): string {
  return findRootTsConfigJsonCore(nodeIo);
}

// The build's own tsconfig when there is one, so sharing and compiling read the same `paths`
// (core#149). Workspace-relative, as the Angular adapter resolves it.
// Undefined without any tsconfig: such a build has no aliases to share.
export function findMappingsTsConfig(): string | undefined {
  return findMappingsTsConfigCore(nodeIo);
}

export function findMappingsTsConfigCore(io: FileReaderPort): string | undefined {
  const { tsConfig, workspaceRoot } = getConfigContext();
  if (!tsConfig) return findRootTsConfigCore(io);

  // `tsConfigPath` is the adapter's to resolve, so cwd is tried too before giving up.
  const candidates = [
    ...new Set([workspaceRoot, toDiskCaseCore(io, cwd())].filter(Boolean) as string[]),
  ].map(base => path.resolve(base, tsConfig));
  const found = candidates.find(file => io.isFile(file));
  if (found) return toDiskCaseCore(io, found);

  const fallback = findRootTsConfigCore(io);
  logger.warn(
    `The tsconfig "${tsConfig}" does not exist (tried ${candidates.join(', ')}); ` +
      (fallback ? `reading shared mappings from ${fallback} instead.` : 'no shared mappings.')
  );
  return fallback;
}

export function findRootTsConfigJsonCore(io: FileReaderPort): string {
  const found = findRootTsConfigCore(io, true);
  if (!found) throw new Error('Neither a tsconfig.json nor a tsconfig.base.json was found');
  return found;
}

// Lenient: throws only when neither folder has a package.json. Strict keeps the deprecated
// export's errors as they were.
function findRootTsConfigCore(io: FileReaderPort, strict = false): string | undefined {
  const from = toDiskCaseCore(io, cwd());
  const { workspaceRoot } = getConfigContext();
  const second =
    workspaceRoot && path.resolve(workspaceRoot) !== from ? path.resolve(workspaceRoot) : undefined;
  // cwd stays first so an existing resolution doesn't move (core#156).
  let cwdError: unknown;
  try {
    const found = findTsConfigNextToPackageJson(io, from);
    if (found) return found;
  } catch (err) {
    cwdError = err;
  }
  if (!second) {
    if (cwdError) throw cwdError;
    return undefined;
  }
  try {
    return findTsConfigNextToPackageJson(io, second);
  } catch (err) {
    if (cwdError || strict) throw err;
    return undefined;
  }
}

function findTsConfigNextToPackageJson(io: FileReaderPort, folder: string): string | undefined {
  const packageJson = findPackageJson(io, folder);
  const projectRoot = path.dirname(packageJson);
  const tsConfigBaseJson = path.join(projectRoot, 'tsconfig.base.json');
  const tsConfigJson = path.join(projectRoot, 'tsconfig.json');

  if (io.exists(tsConfigBaseJson)) {
    return tsConfigBaseJson;
  } else if (io.exists(tsConfigJson)) {
    return tsConfigJson;
  }
  return undefined;
}

export function findPackageJson(io: FileReaderPort, folder: string): string {
  while (!io.exists(path.join(folder, 'package.json')) && path.dirname(folder) !== folder) {
    folder = path.dirname(folder);
  }

  const filePath = path.join(folder, 'package.json');
  if (io.exists(filePath)) {
    return filePath;
  }

  throw new Error(
    'no package.json found. Searched the following folder and all parents: ' + folder
  );
}

export function inferProjectPath(
  projectPath: string | undefined,
  io: FileReaderPort = nodeIo
): string {
  if (!projectPath && getConfigContext().packageJson) {
    projectPath = path.dirname(getConfigContext().packageJson || '');
  }

  if (!projectPath && getConfigContext().workspaceRoot) {
    projectPath = getConfigContext().workspaceRoot || '';
  }

  if (!projectPath) {
    projectPath = toDiskCaseCore(io, cwd());
  }
  return projectPath;
}
