import type { ArtifactInfo } from '../../domain/core/federation-info.contract.js';
import type { NormalizedFederationOptions } from '../../domain/core/federation-options.contract.js';
import type { DenseFederationInfo } from './densify-externals.js';
import { writeFederationInfo } from './write-federation-info.js';
import { writeImportMap } from './write-import-map.js';

// The import map takes the flat externals, not `federationInfo.shared`: a dense group has no
// import-map representation, every specifier needs its own entry.
export function writeFederationOutputs(
  federationInfo: DenseFederationInfo,
  fedOptions: NormalizedFederationOptions,
  artifactInfo: Pick<ArtifactInfo, 'mappings'>
): void {
  writeFederationInfo(federationInfo, fedOptions);
  writeImportMap(
    {
      externals: [...fedOptions.federationCache.externals, ...artifactInfo.mappings],
      chunks: chunkFiles(federationInfo),
    },
    fedOptions,
    federationInfo.integrity
  );
}

// Not keyed by packageName: densify can publish several records under one name.
function chunkFiles({ exposes, shared }: DenseFederationInfo): string[] {
  const files = [...exposes, ...shared].flatMap(owner =>
    Object.values(owner.chunks ?? {}).map(c => c.file)
  );
  return [...new Set(files)];
}
