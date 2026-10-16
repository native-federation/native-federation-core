import * as path from 'path';
import { cwd } from 'process';
import { getConfigContext } from './configuration-context.js';
import { nodeIo } from '../utils/io/node-io-adapter.js';
import type { FileReaderPort } from '../domain/utils/io-port.contract.js';
import { toDiskCase } from '../utils/disk-case.js';
import { logger } from '../utils/logger.js';

export function findRootTsConfigJson(): string {
  return findRootTsConfigJsonCore(nodeIo);
}

// The build's own tsconfig when there is one, so sharing and compiling read the same `paths`
// (core#149). Workspace-relative, as the Angular adapter resolves it.
export function findMappingsTsConfig(): string {
  return findMappingsTsConfigCore(nodeIo);
}

export function findMappingsTsConfigCore(io: FileReaderPort): string {
  const { tsConfig, workspaceRoot } = getConfigContext();
  if (!tsConfig) return findRootTsConfigJsonCore(io);

  // `tsConfigPath` is the adapter's to resolve, so cwd is tried too before giving up.
  const candidates = [
    ...new Set([workspaceRoot, toDiskCase(io, cwd())].filter(Boolean) as string[]),
  ].map(base => path.resolve(base, tsConfig));
  const found = candidates.find(file => io.isFile(file));
  if (found) return toDiskCase(io, found);

  const fallback = findRootTsConfigJsonCore(io);
  logger.warn(
    `The tsconfig "${tsConfig}" does not exist (tried ${candidates.join(', ')}); ` +
      `reading shared mappings from ${fallback} instead.`
  );
  return fallback;
}

export function findRootTsConfigJsonCore(io: FileReaderPort): string {
  const from = toDiskCase(io, cwd());
  try {
    return findTsConfigNextToPackageJson(io, from);
  } catch (err) {
    // cwd stays first so an existing resolution doesn't move (core#156).
    const { workspaceRoot } = getConfigContext();
    if (!workspaceRoot || path.resolve(workspaceRoot) === from) throw err;
    return findTsConfigNextToPackageJson(io, path.resolve(workspaceRoot));
  }
}

function findTsConfigNextToPackageJson(io: FileReaderPort, folder: string): string {
  const packageJson = findPackageJson(io, folder);
  const projectRoot = path.dirname(packageJson);
  const tsConfigBaseJson = path.join(projectRoot, 'tsconfig.base.json');
  const tsConfigJson = path.join(projectRoot, 'tsconfig.json');

  if (io.exists(tsConfigBaseJson)) {
    return tsConfigBaseJson;
  } else if (io.exists(tsConfigJson)) {
    return tsConfigJson;
  }

  throw new Error('Neither a tsconfig.json nor a tsconfig.base.json was found');
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
    projectPath = toDiskCase(io, cwd());
  }
  return projectPath;
}
