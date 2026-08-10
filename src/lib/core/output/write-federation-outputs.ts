import type { FederationInfo } from '../../domain/core/federation-info.contract.js';
import type { NormalizedFederationOptions } from '../../domain/core/federation-options.contract.js';
import { writeFederationInfo } from './write-federation-info.js';
import { writeImportMap } from './write-import-map.js';

/**
 * The import map is built from the flat federation cache rather than `federationInfo.shared`: a
 * dense group has no import-map representation, every specifier needs its own entry.
 */
export function writeFederationOutputs(
  federationInfo: FederationInfo,
  fedOptions: NormalizedFederationOptions
): void {
  writeFederationInfo(federationInfo, fedOptions);
  writeImportMap(fedOptions.federationCache, fedOptions, federationInfo.integrity);
}
