import type { ArtifactInfo, FederationInfo } from '../../domain/core/federation-info.contract.js';
import type { NormalizedFederationOptions } from '../../domain/core/federation-options.contract.js';
import { writeFederationInfo } from './write-federation-info.js';
import { writeImportMap } from './write-import-map.js';

// The import map takes the flat externals, not `federationInfo.shared`: a dense group has no
// import-map representation, every specifier needs its own entry.
export function writeFederationOutputs(
  federationInfo: FederationInfo,
  fedOptions: NormalizedFederationOptions,
  artifactInfo: Pick<ArtifactInfo, 'mappings'>
): void {
  writeFederationInfo(federationInfo, fedOptions);
  writeImportMap(
    {
      externals: [...fedOptions.federationCache.externals, ...artifactInfo.mappings],
      chunks: federationInfo.chunks,
    },
    fedOptions,
    federationInfo.integrity
  );
}
