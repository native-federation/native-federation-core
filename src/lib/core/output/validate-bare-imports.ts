import * as path from 'path';
import { isBuiltin } from 'module';
import type { OutputFile } from '../../domain/core/federation-info.contract.js';
import type { NormalizedFederationConfig } from '../../domain/config/federation-config.contract.js';
import type { NormalizedFederationOptions } from '../../domain/core/federation-options.contract.js';
import type { FileReaderPort } from '../../domain/utils/io-port.contract.js';
import type { FederationCache } from '../../domain/core/federation-cache.contract.js';
import type { DenseFederationInfo } from './densify-externals.js';
import { CHUNK_PREFIX } from '../../domain/core/chunk.js';
import { isScript } from '../../utils/script-file.js';
import { isInSkipList } from '../../config/default-skip-list.js';
import { inferPackageFromSecondary } from '../../utils/normalize.js';
import { resolveOutputPath } from '../../utils/output-path.js';
import { readBareImports } from '../../utils/bare-specifier.js';
import { matchesExternal } from '../../utils/path-patterns.js';
import { nodeIo } from '../../utils/io/node-io-adapter.js';
import { logger } from '../../utils/logger.js';
import { formatList } from '../../utils/format-list.js';

interface UnresolvedImport {
  kind: 'unresolved' | 'unlisted-chunk';
  specifier: string;
  importers: string[];
  reason: string;
}

export interface BareImportScan {
  unresolved: UnresolvedImport[];
  unparsable: { fileName: string; error: string }[];
}

type FindingKind = UnresolvedImport['kind'] | 'unparsable';

interface Finding {
  kind: FindingKind;
  message: string;
  // Only findings with a specifier take part in the rebuild suppression key.
  specifier?: string;
}

const reportedSpecifiers = new WeakMap<FederationCache, string>();

export function validateBareImports(
  config: NormalizedFederationConfig,
  fedOptions: NormalizedFederationOptions,
  federationInfo: DenseFederationInfo,
  files: OutputFile[],
  { fullReport }: { fullReport: boolean }
): void {
  const start = process.hrtime();
  const outputDir = resolveOutputPath(fedOptions);
  const scan = findUnresolvedImportsCore(nodeIo, outputDir, files, config, federationInfo);
  logger.measure(start, 'Validated the bare imports of the published files.');

  const strict = config.features.strictImports;
  // An unlisted chunk is broken whatever the config says, but a watch rebuild only warns so the dev
  // loop keeps running; the next full build fails.
  const failsAnyway = (kind: FindingKind) => fullReport && kind === 'unlisted-chunk';
  const fails = (kind: FindingKind) => strict || failsAnyway(kind);

  // A watch rebuild repeating unchanged warnings buries new ones. Only the specifiers are compared:
  // chunks are named after their content, so an edit renames the importers.
  const findings = toFindings(scan);
  const key = findings.flatMap(f => f.specifier ?? []).join('\n');
  const previous = reportedSpecifiers.get(fedOptions.federationCache);
  reportedSpecifiers.set(fedOptions.federationCache, key);
  const unchanged = !fullReport && key === previous;

  let quieted = 0;
  for (const finding of findings) {
    if (fails(finding.kind)) logger.error(finding.message);
    else if (unchanged && finding.specifier !== undefined) quieted++;
    else logger.warn(finding.message);
  }
  if (quieted > 0) {
    logger.notice(`${quieted} finding(s) unchanged since the last build.`);
  }
  if (!fullReport && previous && findings.length === 0) logger.info('All bare imports resolve.');

  const problems = (Object.keys(PROBLEM) as FindingKind[]).flatMap(kind => {
    const count = findings.filter(f => f.kind === kind && fails(kind)).length;
    const tag = failsAnyway(kind) ? '' : ' (features.strictImports)';
    return count > 0 ? [PROBLEM[kind](count) + tag] : [];
  });
  if (problems.length > 0) {
    throw new Error(`${problems.join(' and ')}. See the errors above.`);
  }
}

const PROBLEM: Record<FindingKind, (count: number) => string> = {
  unresolved: n => `${n} bare import(s) cannot be resolved from remoteEntry.json`,
  'unlisted-chunk': n => `${n} chunk(s) are listed by no exposed module or shared record`,
  unparsable: n => `${n} file(s) could not be scanned`,
};

function toFindings({ unresolved, unparsable }: BareImportScan): Finding[] {
  return [
    ...unparsable.map(({ fileName, error }) => ({
      kind: 'unparsable' as const,
      message: `Could not scan '${fileName}': ${error}`,
    })),
    ...unresolved.map(({ kind, specifier, importers, reason }) => ({
      kind,
      specifier,
      message: `'${specifier}' will not resolve (imported by ${formatList(importers, 3)}). ${reason}`,
    })),
  ];
}

// The import map only has exact keys, so a subpath of a shared package resolves only when it is
// declared itself — whatever the bundler was told to keep external.
export function findUnresolvedImportsCore(
  io: FileReaderPort,
  outputDir: string,
  files: OutputFile[],
  config: NormalizedFederationConfig,
  federationInfo: DenseFederationInfo
): BareImportScan {
  const declared = declaredSpecifiers(federationInfo);
  const importersBySpecifier = new Map<string, string[]>();
  const unparsable: BareImportScan['unparsable'] = [];

  for (const file of files.filter(f => isScript(f.fileName))) {
    const filePath = path.join(outputDir, file.fileName);
    // validateOutputFiles has reported it.
    if (!io.exists(filePath)) continue;

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
    .map(([specifier, importers]): UnresolvedImport => {
      const kind = specifier.startsWith(CHUNK_PREFIX + '/') ? 'unlisted-chunk' : 'unresolved';
      return { kind, specifier, importers, reason: explain(specifier, kind, config, declared) };
    });
  return { unresolved, unparsable };
}

function declaredSpecifiers(federationInfo: DenseFederationInfo): Set<string> {
  const declared = new Set<string>();
  for (const shared of federationInfo.shared) {
    Object.keys(shared.entries).forEach(key => declared.add(key));
  }
  for (const owner of [...federationInfo.shared, ...federationInfo.exposes]) {
    Object.keys(owner.chunks ?? {}).forEach(key => declared.add(key));
  }
  return declared;
}

// A shared root decides first: 'process/browser' with 'process' shared is a pruned entry point, not
// a built-in.
function explain(
  specifier: string,
  kind: UnresolvedImport['kind'],
  config: NormalizedFederationConfig,
  declared: ReadonlySet<string>
): string {
  if (kind === 'unlisted-chunk') {
    return (
      'No exposed module or shared record lists this chunk, so the import map has no key for it. ' +
      'Report this to your build adapter: it must return every file it wrote, chunks included.'
    );
  }

  const mapping = Object.values(config.sharedMappings).find(m => specifier.startsWith(m + '/'));
  if (mapping) {
    return `Import the shared mapping '${mapping}' itself, not a subpath.`;
  }

  const root = inferPackageFromSecondary(specifier);
  if (declared.has(root) || root in config.shared) {
    if (isInSkipList(specifier, config.skip)) {
      return `It is in 'skip', but '${root}' is shared: remove it from 'skip'.`;
    }
    return (
      `'${root}' is shared, but not this entry point (pruned, or not exported). ` +
      `Set includeSecondaries: { keepAll: true } on '${root}'.`
    );
  }

  if (isBuiltin(specifier)) {
    const polyfill = specifier === root && !specifier.startsWith('node:');
    return (
      'Node.js built-in in a browser bundle: skip the package that imports it, or build it with ' +
      "platform: 'node'." +
      (polyfill ? ' If it is the npm polyfill, share it.' : '')
    );
  }

  return "Share it, or add it to 'externals'.";
}
