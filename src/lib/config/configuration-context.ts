import { nodeIo } from '../utils/io/node-io-adapter.js';
import { toDiskCase } from '../utils/disk-case.js';
import type { FileReaderPort } from '../domain/utils/io-port.contract.js';

export interface ConfigurationContext {
  workspaceRoot?: string;
  packageJson?: string;
}

let _context: ConfigurationContext = {};

export function useWorkspace(workspaceRoot: string, io: FileReaderPort = nodeIo): void {
  _context = { ..._context, workspaceRoot: toDiskCase(io, workspaceRoot) };
}

export function usePackageJson(packageJson?: string): void {
  _context = { ..._context, packageJson };
}

export function getConfigContext(): ConfigurationContext {
  return _context;
}
