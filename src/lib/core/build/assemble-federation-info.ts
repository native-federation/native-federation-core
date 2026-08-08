import type {
  ArtifactInfo,
  FederationInfo,
  SharedInfo,
} from '../../domain/core/federation-info.contract.js';
import type { NormalizedFederationConfig } from '../../domain/config/federation-config.contract.js';
import type { NormalizedFederationOptions } from '../../domain/core/federation-options.contract.js';
import { densifyExternals } from '../output/densify-externals.js';
import { writeFederationInfo } from '../output/write-federation-info.js';
import { writeImportMap } from '../output/write-import-map.js';
import { describeExposed, describeSharedMappings } from './bundle-exposed-and-mappings.js';

/**
 * Turns the populated federation cache into `remoteEntry.json` + `importmap.json`. Shared by the
 * initial build and the watch rebuild: both must emit byte-identical metadata for the same inputs,
 * so every field of `FederationInfo` is derived here and nowhere else.
 */
export function assembleFederationInfo(
  config: NormalizedFederationConfig,
  fedOptions: NormalizedFederationOptions,
  artifactInfo: ArtifactInfo | undefined
): FederationInfo {
  const federationCache = fedOptions.federationCache;

  const exposedInfo = !artifactInfo ? describeExposed(config, fedOptions) : artifactInfo.exposes;
  const sharedMappingInfo = !artifactInfo
    ? describeSharedMappings(config, fedOptions)
    : artifactInfo.mappings;

  // Scope before densify: `densifyExternals` groups by shareScope and copies it onto the group.
  const sharedExternals = applyShareScope(
    [...federationCache.externals, ...sharedMappingInfo],
    config.shareScope
  );

  const federationInfo: FederationInfo = {
    name: config.name,
    shared: config.features.denseExternals ? densifyExternals(sharedExternals) : sharedExternals,
    exposes: exposedInfo,
    buildNotificationsEndpoint:
      fedOptions.buildNotifications?.enable && fedOptions.dev
        ? fedOptions.buildNotifications?.endpoint
        : undefined,
  };

  if (federationCache.chunks) {
    federationInfo.chunks = federationCache.chunks;
  }
  if (artifactInfo?.chunks) {
    federationInfo.chunks = { ...(federationInfo.chunks ?? {}), ...artifactInfo.chunks };
  }

  if (config.features.integrityHashes) {
    federationInfo.integrity = {
      ...(federationCache.integrity ?? {}),
      ...(artifactInfo?.integrity ?? {}),
    };
  }

  writeFederationInfo(federationInfo, fedOptions);
  writeImportMap(federationCache, fedOptions, federationInfo.integrity);

  return federationInfo;
}

/**
 * Copies rather than mutating: cached externals outlive a single build, and shared mappings are
 * described anew on every rebuild, so an in-place default would apply to one group and not the
 * other.
 */
function applyShareScope(externals: SharedInfo[], shareScope: string | undefined): SharedInfo[] {
  if (!shareScope) return externals;
  return externals.map(external => (external.shareScope ? external : { ...external, shareScope }));
}
