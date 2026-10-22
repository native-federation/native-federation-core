import * as path from 'path';
import type { FederationInfo, OutputFile } from '../../domain/core/federation-info.contract.js';
import type { NormalizedFederationOptions } from '../../domain/core/federation-options.contract.js';
import type { FileReaderPort } from '../../domain/utils/io-port.contract.js';
import { resolveOutputPath } from '../../utils/output-path.js';
import { nodeIo } from '../../utils/io/node-io-adapter.js';
import { logger } from '../../utils/logger.js';
import { formatList } from '../../utils/format-list.js';

export function validateOutputFiles(
  fedOptions: NormalizedFederationOptions,
  federationInfo: FederationInfo,
  files: OutputFile[]
): void {
  validateOutputFilesCore(nodeIo, resolveOutputPath(fedOptions), federationInfo, files);
}

// Runs after every bundle: one deleting another's files (Vite's emptyOutDir, Rspack's output.clean)
// is invisible to a per-bundle check.
export function validateOutputFilesCore(
  io: FileReaderPort,
  outputDir: string,
  federationInfo: FederationInfo,
  files: OutputFile[]
): void {
  const missing = files
    .map(file => file.fileName)
    .filter(fileName => !io.exists(path.join(outputDir, fileName)));
  if (missing.length === 0) return;

  const cause =
    `missing from '${outputDir}': written into a subfolder, or deleted after it was written ` +
    "(e.g. by Vite's emptyOutDir).";
  const published = publishedFileNames(federationInfo);
  const broken = missing.filter(fileName => published.has(fileName));
  if (broken.length > 0) {
    throw new Error(`remoteEntry.json names ${formatList(broken, 3)}, ${cause}`);
  }
  // A source map or stylesheet nothing loads by name: an outputFiles contract break, never fatal.
  logger.warn(`Output file(s) ${formatList(missing, 3)} ${cause}`);
}

function publishedFileNames(federationInfo: FederationInfo): Set<string> {
  const names = new Set(federationInfo.exposes.map(exposed => exposed.outFileName));
  for (const shared of federationInfo.shared) {
    if ('entries' in shared) Object.values(shared.entries).forEach(name => names.add(name));
    else names.add(shared.outFileName);
  }
  for (const chunks of Object.values(federationInfo.chunks ?? {})) {
    chunks.forEach(chunk => names.add(chunk));
  }
  return names;
}
