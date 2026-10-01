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

let pendingLoad: Promise<unknown> = Promise.resolve();

// The context is global and a config reads it while it evaluates, so concurrent loads (several
// remotes built in one process) are queued; otherwise each config sees the last caller's context.
export function loadWithConfigContext<T>(
  context: ConfigurationContext,
  load: () => Promise<T>,
  io: FileReaderPort = nodeIo
): Promise<T> {
  const run = pendingLoad.then(() => {
    useWorkspace(context.workspaceRoot ?? '', io);
    usePackageJson(context.packageJson);
    return load();
  });
  pendingLoad = run.catch(() => undefined);
  return run;
}
