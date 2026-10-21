import * as path from 'path';
import { isBuiltin } from 'module';
import type { FederationInfo, OutputFile } from '../../domain/core/federation-info.contract.js';
import type { NormalizedFederationConfig } from '../../domain/config/federation-config.contract.js';
import type { NormalizedFederationOptions } from '../../domain/core/federation-options.contract.js';
import type { FileReaderPort } from '../../domain/utils/io-port.contract.js';
import { toChunkImport } from '../../domain/core/chunk.js';
import { isScript } from '../../utils/script-file.js';
import { isInSkipList } from '../../config/default-skip-list.js';
import { inferPackageFromSecondary } from '../../utils/normalize.js';
import { resolveOutputPath } from '../../utils/output-path.js';
import { readBareImports } from '../../utils/bare-specifier.js';
import { matchesExternal } from '../../utils/path-patterns.js';
import { nodeIo } from '../../utils/io/node-io-adapter.js';
import { logger } from '../../utils/logger.js';

interface UnresolvedImport {
  specifier: string;
  importers: string[];
  reason: string;
}

export interface BareImportScan {
  unresolved: UnresolvedImport[];
  unparsable: { fileName: string; error: string }[];
  missing: string[];
}

export function validateBareImports(
  config: NormalizedFederationConfig,
  fedOptions: NormalizedFederationOptions,
  federationInfo: FederationInfo,
  files: OutputFile[]
): void {
  const start = process.hrtime();
  const outputDir = resolveOutputPath(fedOptions);
  const { unresolved, unparsable, missing } = findUnresolvedImportsCore(
    nodeIo,
    outputDir,
    files,
    config,
    federationInfo
  );
  logger.measure(start, 'Validated the bare imports of the published files.');

  // An adapter that breaks the outputFiles contract is its bug, not the build's: never fatal.
  if (missing.length > 0) {
    logger.warn(
      `Reported as written but not in '${outputDir}', so not scanned: ${formatFiles(missing)}. ` +
        'NFBuildAdapter.build must write its files flat into outdir.'
    );
  }

  const strict = config.features.strictImports;
  const report = strict ? logger.error : logger.warn;
  for (const { fileName, error } of unparsable) {
    report(`Could not scan the imports of '${fileName}' (${error}), so they were not checked.`);
  }
  for (const { specifier, importers, reason } of unresolved) {
    report(
      `${formatFiles(importers)} import${importers.length === 1 ? 's' : ''} ` +
        `'${specifier}', which remoteEntry.json does not declare, so it will not resolve at ` +
        `runtime. ${reason}`
    );
  }

  if (strict && (unresolved.length > 0 || unparsable.length > 0)) {
    const problems: string[] = [];
    if (unresolved.length > 0) {
      problems.push(`${unresolved.length} bare import(s) cannot be resolved from remoteEntry.json`);
    }
    if (unparsable.length > 0) problems.push(`${unparsable.length} file(s) could not be scanned`);
    throw new Error(`${problems.join(' and ')} (features.strictImports). See the errors above.`);
  }
}

// The import map only has exact keys, so a subpath of a shared package resolves only when it is
// declared itself — whatever the bundler was told to keep external.
export function findUnresolvedImportsCore(
  io: FileReaderPort,
  outputDir: string,
  files: OutputFile[],
  config: NormalizedFederationConfig,
  federationInfo: FederationInfo
): BareImportScan {
  const declared = declaredSpecifiers(federationInfo);
  const importersBySpecifier = new Map<string, string[]>();
  const unparsable: BareImportScan['unparsable'] = [];
  const missing: string[] = [];

  for (const file of files.filter(f => isScript(f.fileName))) {
    const filePath = path.join(outputDir, file.fileName);
    if (!io.exists(filePath)) {
      missing.push(file.fileName);
      continue;
    }

    let specifiers: string[];
    try {
      specifiers = readBareImports(io, filePath, file.fileName);
    } catch (e) {
      unparsable.push({ fileName: file.fileName, error: (e as Error).message });
      continue;
    }
    for (const specifier of specifiers) {
      if (declared.has(specifier) || config.externals.some(e => matchesExternal(specifier, e)))
        continue;
      if (file.platform === 'node' && isBuiltin(specifier)) continue;

      const importers = importersBySpecifier.get(specifier) ?? [];
      if (!importers.includes(file.fileName)) importers.push(file.fileName);
      importersBySpecifier.set(specifier, importers);
    }
  }

  const unresolved = [...importersBySpecifier]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([specifier, importers]) => ({
      specifier,
      importers,
      reason: explain(specifier, config, declared),
    }));
  return { unresolved, unparsable, missing };
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

// A shared root decides first: 'process/browser' with 'process' shared is a pruned entry point, not
// a built-in.
function explain(
  specifier: string,
  config: NormalizedFederationConfig,
  declared: ReadonlySet<string>
): string {
  const mapping = Object.values(config.sharedMappings).find(m => specifier.startsWith(m + '/'));
  if (mapping) {
    return `It is a subpath of the shared mapping '${mapping}'. Import the mapping by its exact name.`;
  }

  const root = inferPackageFromSecondary(specifier);
  if (declared.has(root) || root in config.shared) {
    if (isInSkipList(specifier, config.skip)) {
      return `It is skipped, but stays external because '${root}' is shared. Remove it from 'skip'.`;
    }
    return (
      `'${root}' is shared, but this entry point was not published: 'ignoreUnusedDeps' pruned it, ` +
      `or '${root}' does not export it. Set includeSecondaries: { keepAll: true } on '${root}', ` +
      "or disable 'ignoreUnusedDeps'."
    );
  }

  if (isBuiltin(specifier)) {
    const polyfill = specifier === root && !specifier.startsWith('node:');
    return (
      'It is a Node.js built-in in a browser bundle: the package that imports it is probably ' +
      "Node-only. Skip that package in your federation config, or build it with platform: 'node'." +
      (polyfill ? ` If it is the npm polyfill '${specifier}', share it.` : '')
    );
  }

  return "Share it, or list it in 'externals' if the host page provides it.";
}

function formatFiles(files: string[]): string {
  const shown = files
    .slice(0, 3)
    .map(file => `'${file}'`)
    .join(', ');
  return files.length > 3 ? `${shown} and ${files.length - 3} more` : shown;
}
