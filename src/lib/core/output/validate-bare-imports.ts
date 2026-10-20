import * as path from 'path';
import { builtinModules } from 'module';
import type { FederationInfo } from '../../domain/core/federation-info.contract.js';
import type { NormalizedFederationConfig } from '../../domain/config/federation-config.contract.js';
import type { NormalizedFederationOptions } from '../../domain/core/federation-options.contract.js';
import type { FileReaderPort } from '../../domain/utils/io-port.contract.js';
import { toChunkImport } from '../../domain/core/chunk.js';
import { isInSkipList } from '../../config/default-skip-list.js';
import { inferPackageFromSecondary } from '../../utils/normalize.js';
import { resolveOutputPath } from '../../utils/output-path.js';
import { matchesExternal, readBareImports } from '../../utils/bare-specifier.js';
import { isScript } from '../../utils/script-file.js';
import { nodeIo } from '../../utils/io/node-io-adapter.js';
import { logger } from '../../utils/logger.js';

export interface UnresolvedImport {
  specifier: string;
  importers: string[];
  reason: string;
}

interface PublishedFile {
  fileName: string;
  allowsBuiltins: boolean;
}

export function validateBareImports(
  config: NormalizedFederationConfig,
  fedOptions: NormalizedFederationOptions,
  federationInfo: FederationInfo
): void {
  const start = process.hrtime();
  const unresolved = findUnresolvedImportsCore(
    nodeIo,
    resolveOutputPath(fedOptions),
    config,
    federationInfo
  );
  logger.measure(start, 'Validated the bare imports of the published files.');

  if (unresolved.length === 0) return;

  const report = config.features.strictImports ? logger.error : logger.warn;
  for (const { specifier, importers, reason } of unresolved) {
    report(
      `${formatImporters(importers)} import${importers.length === 1 ? 's' : ''} ` +
        `'${specifier}', which remoteEntry.json does not declare, so it will not resolve at ` +
        `runtime. ${reason}`
    );
  }

  if (config.features.strictImports) {
    throw new Error(
      `${unresolved.length} bare import(s) cannot be resolved from remoteEntry.json ` +
        '(features.strictImports). See the errors above.'
    );
  }
}

// The import map only has exact keys, so a subpath of a shared package resolves only when it is
// declared itself — whatever the bundler was told to keep external.
export function findUnresolvedImportsCore(
  io: FileReaderPort,
  outputDir: string,
  config: NormalizedFederationConfig,
  federationInfo: FederationInfo
): UnresolvedImport[] {
  const declared = declaredSpecifiers(federationInfo);
  const importersBySpecifier = new Map<string, string[]>();

  for (const file of publishedFiles(config, federationInfo)) {
    const filePath = path.join(outputDir, file.fileName);
    if (!io.exists(filePath)) continue;

    for (const specifier of readBareImports(io, filePath, file.fileName)) {
      if (declared.has(specifier) || matchesExternal(specifier, config.externals)) continue;
      if (file.allowsBuiltins && isNodeBuiltin(specifier)) continue;

      const importers = importersBySpecifier.get(specifier) ?? [];
      if (!importers.includes(file.fileName)) importers.push(file.fileName);
      importersBySpecifier.set(specifier, importers);
    }
  }

  return [...importersBySpecifier]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([specifier, importers]) => ({
      specifier,
      importers,
      reason: explain(specifier, config, declared),
    }));
}

function declaredSpecifiers(federationInfo: FederationInfo): Set<string> {
  const declared = new Set<string>();
  for (const shared of federationInfo.shared) {
    if ('entries' in shared) Object.keys(shared.entries).forEach(key => declared.add(key));
    else declared.add(shared.packageName);
  }
  for (const chunks of Object.values(federationInfo.chunks ?? {})) {
    chunks.forEach(chunk => declared.add(toChunkImport(chunk)));
  }
  return declared;
}

function publishedFiles(
  config: NormalizedFederationConfig,
  federationInfo: FederationInfo
): PublishedFile[] {
  const isNode = (key: string) => config.shared[key]?.platform === 'node';
  // A chunk records which bundle it came from only when chunking is dense.
  const anyNode = Object.keys(config.shared).some(isNode);

  const files: PublishedFile[] = [];
  for (const shared of federationInfo.shared) {
    if ('entries' in shared) {
      for (const [key, fileName] of Object.entries(shared.entries)) {
        files.push({ fileName, allowsBuiltins: isNode(key) });
      }
    } else {
      files.push({
        fileName: shared.outFileName,
        allowsBuiltins: isNode(shared.packageName) || (isChunk(shared.packageName) && anyNode),
      });
    }
  }
  for (const [bundle, chunks] of Object.entries(federationInfo.chunks ?? {})) {
    for (const fileName of chunks) {
      files.push({ fileName, allowsBuiltins: bundle.startsWith('node-') });
    }
  }
  for (const exposed of federationInfo.exposes) {
    files.push({ fileName: exposed.outFileName, allowsBuiltins: false });
  }
  return files.filter(file => isScript(file.fileName));
}

function isChunk(packageName: string): boolean {
  return packageName.startsWith(toChunkImport(''));
}

function isNodeBuiltin(specifier: string): boolean {
  return specifier.startsWith('node:') || builtinModules.includes(specifier.split('/')[0]!);
}

function explain(
  specifier: string,
  config: NormalizedFederationConfig,
  declared: ReadonlySet<string>
): string {
  if (isNodeBuiltin(specifier)) {
    return (
      'It is a Node.js built-in in a browser bundle: the package that imports it is probably ' +
      "Node-only. Skip that package in your federation config, or build it with platform: 'node'."
    );
  }

  const mapping = Object.values(config.sharedMappings).find(m => specifier.startsWith(m + '/'));
  if (mapping) {
    return `It is a subpath of the shared mapping '${mapping}'. Import the mapping by its exact name.`;
  }

  const root = inferPackageFromSecondary(specifier);
  const sharedRoot = declared.has(root) || root in config.shared;

  if (isInSkipList(specifier, config.skip) && sharedRoot) {
    return `It is skipped, but stays external because '${root}' is shared. Remove it from 'skip'.`;
  }

  if (sharedRoot) {
    return (
      `'${root}' is shared, but this entry point was not published. Set ` +
      `includeSecondaries: { keepAll: true } on '${root}', or disable 'ignoreUnusedDeps'.`
    );
  }

  return "Share it, or list it in 'externals' if the host page provides it.";
}

function formatImporters(importers: string[]): string {
  const shown = importers
    .slice(0, 3)
    .map(file => `'${file}'`)
    .join(', ');
  return importers.length > 3 ? `${shown} and ${importers.length - 3} more` : shown;
}
