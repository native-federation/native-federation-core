import * as path from 'path';
import type { FileReaderPort, HashPort } from '../../domain/utils/io-port.contract.js';
import type { IntegrityMap } from '../../domain/core/federation-info.contract.js';
import { integrityForFileCore } from '../../utils/hash.js';
import { isScript } from '../../utils/script-file.js';

type IntegrityDeps = FileReaderPort & HashPort;

// Keyed by basename. Must run after any rewrite, so the hashes match the bytes on disk.
export function computeIntegrityMapCore(
  io: IntegrityDeps,
  files: string[],
  baseDir: string
): IntegrityMap {
  const integrity: IntegrityMap = {};
  for (const file of files) {
    if (!isScript(file)) continue;
    const fullPath = path.join(baseDir, file);
    if (!io.exists(fullPath)) continue;
    integrity[path.basename(file)] = integrityForFileCore(io, fullPath);
  }
  return integrity;
}
