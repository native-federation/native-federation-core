import type {
  NormalizedFederationConfig,
  NormalizedMappingConfig,
} from '../../domain/config/federation-config.contract.js';
import type { PathToImport } from '../../domain/utils/mapped-path.contract.js';
import { declaredMappingPackages, resolveMappingConfig } from '../../config/mapping-utils.js';
import { inferPackageFromSecondary, normalizePackageName } from '../../utils/normalize.js';

const DEFAULT_MAPPING_BUNDLE = 'mapping-bundle';
// normalizePackageName never emits '-', so neither name can meet a `mapping-<name>` bundle.
const SINGLE_ENTRY_BUNDLE = 'mapping-single-entry';
const DECLARED_BUNDLE_PREFIX = 'mapping-pkg-';

export interface MappingBundlePlan {
  bundleName: string;
  chunks: boolean;
  entries: PathToImport;
}

/** Single source of truth for mapping -> bundle(name), the counterpart of `planSharedBundles`.
 *  'separate' gives one bundle per entry point, 'package' one per mapped package, so the
 *  expansions of a wildcard mapping stay together. Declared packages: AGENTS.md, Chunks. */
export function planMappingBundles(config: NormalizedFederationConfig): MappingBundlePlan[] {
  const declaredPackages = declaredMappingPackages(config);
  const entriesByBundle = new Map<string, PathToImport>();
  const entriesByPackage = new Map<string, PathToImport>();

  for (const [mappedPath, mappedImport] of Object.entries(config.sharedMappings)) {
    const packageName = declaredPackages.get(mappedImport);
    if (packageName) {
      addEntry(entriesByPackage, packageName, mappedPath, mappedImport);
      continue;
    }

    const { build } = resolveMappingConfig(
      mappedImport,
      config.sharedMappingsConfig,
      config.features.mappingVersion
    );
    addEntry(entriesByBundle, bundleNameFor(build, mappedImport), mappedPath, mappedImport);
  }

  const plans = [...entriesByBundle].map(([bundleName, entries]) => ({
    bundleName,
    chunks: config.chunks,
    entries,
  }));
  return [...plans, ...planDeclaredPackages(entriesByPackage, config.chunks)];
}

function planDeclaredPackages(
  entriesByPackage: Map<string, PathToImport>,
  chunks: boolean
): MappingBundlePlan[] {
  const singleEntry: PathToImport = {};
  const plans: MappingBundlePlan[] = [];
  const claimedBy = new Map<string, string>();

  for (const [packageName, entries] of entriesByPackage) {
    if (Object.keys(entries).length === 1) {
      Object.assign(singleEntry, entries);
      continue;
    }

    const bundleName = DECLARED_BUNDLE_PREFIX + normalizePackageName(packageName);
    const claimant = claimedBy.get(bundleName);
    if (claimant) {
      throw new Error(
        `Declared packages '${claimant}' and '${packageName}' would both be bundled as '${bundleName}'. Rename one of them.`
      );
    }
    claimedBy.set(bundleName, packageName);
    plans.push({ bundleName, chunks, entries });
  }

  if (Object.keys(singleEntry).length === 0) return plans;
  return [{ bundleName: SINGLE_ENTRY_BUNDLE, chunks: false, entries: singleEntry }, ...plans];
}

function addEntry(
  groups: Map<string, PathToImport>,
  key: string,
  mappedPath: string,
  mappedImport: string
): void {
  const entries = groups.get(key) ?? {};
  entries[mappedPath] = mappedImport;
  groups.set(key, entries);
}

function bundleNameFor(build: NormalizedMappingConfig['build'], mappedImport: string): string {
  if (!build) return DEFAULT_MAPPING_BUNDLE;
  return `mapping-${normalizePackageName(
    build === 'separate' ? mappedImport : inferPackageFromSecondary(mappedImport)
  )}`;
}
