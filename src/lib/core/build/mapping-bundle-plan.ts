import type {
  NormalizedFederationConfig,
  NormalizedMappingConfig,
} from '../../domain/config/federation-config.contract.js';
import type { PathToImport } from '../../domain/utils/mapped-path.contract.js';
import { resolveMappingConfig } from '../../config/mapping-utils.js';
import { inferPackageFromSecondary, normalizePackageName } from '../../utils/normalize.js';

const DEFAULT_MAPPING_BUNDLE = 'mapping-bundle';

export interface MappingBundlePlan {
  bundleName: string;
  chunks: boolean;
  entries: PathToImport;
}

interface MappingGroup {
  entries: PathToImport;
  chunks?: { value: boolean; setBy: string };
}

/** Single source of truth for mapping -> bundle(name), the counterpart of `planSharedBundles`.
 *  'separate' gives one bundle per entry point, 'package' one per mapped package, so the
 *  expansions of a wildcard mapping stay together. A declared package selects no bundle. */
export function planMappingBundles(config: NormalizedFederationConfig): MappingBundlePlan[] {
  const groups = new Map<string, MappingGroup>();

  for (const [mappedPath, mappedImport] of Object.entries(config.sharedMappings)) {
    const { build, chunks } = resolveMappingConfig(mappedImport, config);
    const bundleName = bundleNameFor(build, mappedImport);
    const group = groups.get(bundleName) ?? { entries: {} };
    group.entries[mappedPath] = mappedImport;
    if (chunks !== undefined) group.chunks = agreeOnChunks(group, bundleName, chunks, mappedImport);
    groups.set(bundleName, group);
  }

  return [...groups].map(([bundleName, { entries, chunks }]) => ({
    bundleName,
    chunks: chunks?.value ?? config.chunks,
    entries,
  }));
}

// `chunks` is set per bundle, so the mappings in one must agree; a mapping that leaves it out
// takes whatever the others set.
function agreeOnChunks(
  group: MappingGroup,
  bundleName: string,
  value: boolean,
  mappedImport: string
): MappingGroup['chunks'] {
  const agreed = group.chunks;
  if (!agreed) return { value, setBy: mappedImport };
  if (agreed.value === value) return agreed;
  throw new Error(
    `Shared mappings '${agreed.setBy}' (chunks: ${agreed.value}) and '${mappedImport}' ` +
      `(chunks: ${value}) are built in one bundle, '${bundleName}', which can only take one ` +
      `chunks setting. Set the same value, or give a mapping outside a declared package a bundle ` +
      `of its own with build: 'separate' or 'package'.`
  );
}

function bundleNameFor(build: NormalizedMappingConfig['build'], mappedImport: string): string {
  if (!build) return DEFAULT_MAPPING_BUNDLE;
  return `mapping-${normalizePackageName(
    build === 'separate' ? mappedImport : inferPackageFromSecondary(mappedImport)
  )}`;
}
