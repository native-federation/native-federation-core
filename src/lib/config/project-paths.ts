import * as path from 'path';
import { cwd } from 'process';
import { getConfigContext } from './configuration-context.js';
import { nodeIo } from '../utils/io/node-io-adapter.js';
import type { FileReaderPort } from '../domain/utils/io-port.contract.js';
import { toDiskCase } from '../utils/disk-case.js';

export function findRootTsConfigJson(): string {
  return findRootTsConfigJsonCore(nodeIo);
}

export function findRootTsConfigJsonCore(io: FileReaderPort): string {
  const from = toDiskCase(io, cwd());
  try {
    return findTsConfigNextToPackageJson(io, from);
  } catch (err) {
    // cwd stays first so a build that resolves today keeps its tsconfig; workspaceRoot only
    // rescues a build run from outside the workspace (core#156).
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
