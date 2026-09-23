import type { NormalizedFederationConfig } from '../../domain/config/federation-config.contract.js';
import type { PathToImport } from '../../domain/utils/mapped-path.contract.js';
import { resolveMappingConfig } from '../../config/mapping-utils.js';
import { inferPackageFromSecondary, normalizePackageName } from '../../utils/normalize.js';

const DEFAULT_MAPPING_BUNDLE = 'mapping-bundle';

export interface MappingBundlePlan {
  bundleName: string;
  entries: PathToImport;
}

/** Single source of truth for mapping -> bundle(name), the counterpart of `planSharedBundles`.
 *  'separate' gives one bundle per entry point, 'package' one per mapped package, so the
 *  expansions of a wildcard mapping stay together. */
export function planMappingBundles(config: NormalizedFederationConfig): MappingBundlePlan[] {
  const grouped = new Map<string, PathToImport>();

  for (const [mappedPath, mappedImport] of Object.entries(config.sharedMappings)) {
    const { build } = resolveMappingConfig(
      mappedImport,
      config.sharedMappingsConfig,
      config.features.mappingVersion
    );

    const bundleName = !build
      ? DEFAULT_MAPPING_BUNDLE
      : `mapping-${normalizePackageName(
          build === 'separate' ? mappedImport : inferPackageFromSecondary(mappedImport)
        )}`;

    const entries = grouped.get(bundleName) ?? {};
    entries[mappedPath] = mappedImport;
    grouped.set(bundleName, entries);
  }

  return [...grouped].map(([bundleName, entries]) => ({ bundleName, entries }));
}
