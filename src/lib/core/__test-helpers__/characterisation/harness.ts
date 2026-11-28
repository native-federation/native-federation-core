// Runs today's selection in three stages and projects what it publishes, without an adapter:
//   1. normalizeFederationOptionsCore on a memory io, with canned sheriff output, so pruning and the
//      transitive lookup run;
//   2. planSharedBundles / planMappingBundles on the normalized config;
//   3. the record helpers bundleShared and bundleExposedAndMappings use.
// The config helpers read through nodeIo, so the caller writes `row.files` to a real folder,
// `root`, and the memory io mirrors it at the same absolute paths.
import * as path from 'path';
import { vi } from 'vitest';
import type { ProjectData } from '@sheriff-arch/sheriff-core';
import { normalizeFederationOptionsCore } from '../../normalize-options.js';
import { withNativeFederation } from '../../../config/with-native-federation.js';
import { getUsedDependenciesFactoryCore } from '../../../config/get-used-dependencies.js';
import { getExternals } from '../../build/get-externals.js';
import { planSharedBundles } from '../../build/shared-bundle-plan.js';
import { planMappingBundles } from '../../build/mapping-bundle-plan.js';
import {
  buildResult,
  resolveSharedVersions,
  sharedPackageInfos,
} from '../../build/shared-record.js';
import { sharedBundleExternals } from '../../build/default-external-list.js';
import { mappingRecord } from '../../build/mapping-record.js';
import { createMemoryIo } from '../../../utils/io/__test-helpers__/memory-io.js';
import { createPackageJsonRepository } from '../../../utils/io/package-json-repository.js';
import { logger } from '../../../utils/logger.js';
import type { FederationConfig } from '../../../domain/config/federation-config.contract.js';
import type { FederationOptions } from '../../../domain/core/federation-options.contract.js';
import type { SharedInfo } from '../../../domain/core/federation-info.contract.js';

export type Files = Record<string, string>;

// What sheriff reports for one analysed file: the bare packages it imports, and the workspace
// files it imports by specifier (file -> specifier).
export interface ScannedFile {
  packages?: string[];
  files?: Record<string, string>;
}

export interface Row {
  files: Files;
  // Symlink -> its target, both workspace-relative.
  links?: Record<string, string>;
  config: () => FederationConfig;
  // Entry file -> the files sheriff reaches from it. Paths are workspace-relative.
  scan?: Record<string, Record<string, ScannedFile>>;
  options?: Partial<FederationOptions>;
}

interface RecordProjection {
  bundle: string;
  version: string | undefined;
  requiredVersion: string | undefined;
  singleton: boolean | undefined;
  strictVersion: boolean | undefined;
  pool?: string;
  preload?: boolean;
}

export interface Projection {
  shared: Record<string, RecordProjection & { entry: string }>;
  mappings: Record<string, RecordProjection & { path: string }>;
  bundles: Record<string, { platform?: string; chunks: boolean; externals?: string[] }>;
  warnings: string[];
}

export type Outcome =
  { projection: Projection; records: SharedInfo[] } | { throws: string; warnings: string[] };

export async function characterise(row: Row, root: string): Promise<Outcome> {
  const io = createMemoryIo();
  for (const [file, content] of Object.entries(row.files))
    io.setFile(path.join(root, file), content);
  for (const [link, target] of Object.entries(row.links ?? {}))
    io.setSymlink(path.join(root, link), path.join(root, target));
  const repo = createPackageJsonRepository(io);
  const scrub = (text: string) =>
    text.split(root).join('<ws>').split(root.replace(/\\/g, '/')).join('<ws>');
  const relative = (file: string) => path.relative(root, file).replace(/\\/g, '/');

  const warnings: string[] = [];
  vi.spyOn(logger, 'warn').mockImplementation(msg => void warnings.push(scrub(String(msg))));
  for (const level of ['info', 'notice', 'debug', 'verbose'] as const) {
    vi.spyOn(logger, level).mockImplementation(() => undefined);
  }

  // Sheriff hands back data for a relative entry; the canned data is keyed the same way.
  const projectData = (entry: string): ProjectData =>
    Object.fromEntries(
      Object.entries(row.scan?.[entry.replace(/\\/g, '/')] ?? {}).map(([file, scanned]) => [
        file,
        {
          imports: Object.keys(scanned.files ?? {}),
          externalLibraries: scanned.packages ?? [],
          unresolvedImports: [],
          rawImports: Object.fromEntries(
            Object.entries(scanned.files ?? {}).map(([imported, specifier]) => [
              imported,
              [specifier],
            ])
          ),
        },
      ])
    ) as unknown as ProjectData;

  // The tsconfig lookup also tries cwd; a workspace stands on its own only from its own folder.
  const cwd = process.cwd();
  process.chdir(root);
  let normalized;
  try {
    normalized = await normalizeFederationOptionsCore(
      {
        io,
        loadConfig: async () => withNativeFederation(row.config()),
        usedDependenciesFactory: (workspaceRoot, fallbackEntryPoints) =>
          getUsedDependenciesFactoryCore(
            { io, repo, getProjectData: projectData },
            workspaceRoot,
            fallbackEntryPoints
          ),
      },
      {
        workspaceRoot: root,
        outputPath: 'dist',
        federationConfig: 'federation.config.js',
        tsConfig: 'tsconfig.json',
        ...row.options,
      },
      { externals: [], bundlerCache: undefined, cachePath: path.join(root, '.cache') }
    );
  } catch (e) {
    return { throws: scrub((e as Error).message), warnings };
  } finally {
    process.chdir(cwd);
  }
  const { config, options } = normalized;

  const externals = getExternals(config);
  const folder = options.packageJson ? path.dirname(options.packageJson) : options.workspaceRoot;
  const projection: Projection = { shared: {}, mappings: {}, bundles: {}, warnings };
  const records: SharedInfo[] = [];

  for (const plan of planSharedBundles(config, externals)) {
    const versions = resolveSharedVersions(plan.entries, folder, repo);
    const infos = sharedPackageInfos(plan.entries, folder, repo, plan.platform, versions);
    buildResult(infos, plan.entries, []).forEach((record, i) => {
      records.push(record);
      projection.shared[record.packageName] = {
        ...projectRecord(plan.bundleName, record),
        entry: relative(infos[i]!.entryPoint),
      };
    });
    projection.bundles[plan.bundleName] = {
      platform: plan.platform,
      chunks: plan.chunks,
      externals: sharedBundleExternals(
        plan.platform,
        config.features.ignoreUnusedDeps,
        plan.externals
      ).sort(),
    };
  }

  for (const plan of planMappingBundles(config)) {
    for (const [mappedPath, mappedImport] of Object.entries(plan.entries)) {
      const record = mappingRecord(io, mappedPath, mappedImport, config, options);
      projection.mappings[mappedImport] = {
        ...projectRecord(plan.bundleName, record),
        path: relative(mappedPath),
      };
    }
    projection.bundles[plan.bundleName] = { chunks: plan.chunks };
  }

  return { projection, records };
}

function projectRecord(
  bundle: string,
  record: Omit<SharedInfo, 'packageName' | 'outFileName'>
): RecordProjection {
  return {
    bundle,
    version: record.version,
    requiredVersion: record.requiredVersion,
    singleton: record.singleton,
    strictVersion: record.strictVersion,
    ...(record.pool && { pool: record.pool }),
    ...(record.preload && { preload: true }),
  };
}

export function projected(outcome: Outcome): Projection {
  if ('throws' in outcome) throw new Error(`Expected a projection, got: ${outcome.throws}`);
  return outcome.projection;
}
