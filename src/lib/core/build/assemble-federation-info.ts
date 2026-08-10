import type {
  ArtifactInfo,
  FederationInfo,
  SharedInfo,
} from '../../domain/core/federation-info.contract.js';
import type { NormalizedFederationConfig } from '../../domain/config/federation-config.contract.js';
import type { NormalizedFederationOptions } from '../../domain/core/federation-options.contract.js';
import { densifyExternals } from '../output/densify-externals.js';

/**
 * Derives the `remoteEntry.json` payload from the populated federation cache. Shared by the initial
 * build and the watch rebuild.
 */
export function assembleFederationInfo(
  config: NormalizedFederationConfig,
  fedOptions: NormalizedFederationOptions,
  artifactInfo: ArtifactInfo
): FederationInfo {
  const federationCache = fedOptions.federationCache;

  // Scope before densify: shareScope is part of the grouping signature, so an entry inheriting the
  // default must carry it already or it splits from a sibling that set the same scope explicitly.
  const sharedExternals = applyShareScope(
    [...federationCache.externals, ...artifactInfo.mappings],
    config.shareScope
  );

  const federationInfo: FederationInfo = {
    name: config.name,
    shared: config.features.denseExternals ? densifyExternals(sharedExternals) : sharedExternals,
    exposes: artifactInfo.exposes,
    buildNotificationsEndpoint:
      fedOptions.buildNotifications?.enable && fedOptions.dev
        ? fedOptions.buildNotifications?.endpoint
        : undefined,
  };

  if (federationCache.chunks) {
    federationInfo.chunks = federationCache.chunks;
  }
  if (artifactInfo.chunks) {
    federationInfo.chunks = { ...(federationInfo.chunks ?? {}), ...artifactInfo.chunks };
  }

  if (config.features.integrityHashes) {
    federationInfo.integrity = {
      ...(federationCache.integrity ?? {}),
      ...(artifactInfo.integrity ?? {}),
    };
  }

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
