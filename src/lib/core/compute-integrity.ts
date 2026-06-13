import * as path from 'path';
import type { FileReaderPort, HashPort } from '../domain/utils/io-port.contract.js';
import type { IntegrityMap } from '../domain/core/federation-info.contract.js';
import { nodeIo } from '../utils/io/node-io-adapter.js';
import { integrityForFileCore } from '../utils/hash-file.js';

type IntegrityDeps = FileReaderPort & HashPort;

/**
 * Build an SRI map for `files` (resolved against `baseDir`), skipping sourcemaps
 * and files that no longer exist on disk. Keyed by basename. Must run after any
 * post-bundle rewriting so the hashes match the final on-disk bytes.
 */
export function computeIntegrityMapCore(
  io: IntegrityDeps,
  files: string[],
  baseDir: string
): IntegrityMap {
  const integrity: IntegrityMap = {};
  for (const file of files) {
    if (file.endsWith('.map')) continue;
    const fullPath = path.join(baseDir, file);
    if (!io.exists(fullPath)) continue;
    integrity[path.basename(file)] = integrityForFileCore(io, fullPath);
  }
  return integrity;
}

export function computeIntegrityMap(files: string[], baseDir: string): IntegrityMap {
  return computeIntegrityMapCore(nodeIo, files, baseDir);
}
