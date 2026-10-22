import type { ArtifactInfo, FederationInfo } from '../../domain/core/federation-info.contract.js';
import type { NormalizedFederationConfig } from '../../domain/config/federation-config.contract.js';
import type { NormalizedFederationOptions } from '../../domain/core/federation-options.contract.js';
import { assembleFederationInfo } from './assemble-federation-info.js';
import { collectOutputFiles, recordArtifactFiles } from '../cache/federation-cache.js';
import { validateBareImports } from '../output/validate-bare-imports.js';
import { validateOutputFiles } from '../output/validate-output-files.js';
import { writeFederationOutputs } from '../output/write-federation-outputs.js';

export function finalizeFederationBuild(
  config: NormalizedFederationConfig,
  fedOptions: NormalizedFederationOptions,
  artifactInfo: ArtifactInfo,
  { fullReport }: { fullReport: boolean }
): FederationInfo {
  const federationInfo = assembleFederationInfo(config, fedOptions, artifactInfo);
  recordArtifactFiles(fedOptions.federationCache, artifactInfo);
  const outputFiles = collectOutputFiles(fedOptions.federationCache);
  validateOutputFiles(fedOptions, federationInfo, outputFiles);
  validateBareImports(config, fedOptions, federationInfo, outputFiles, { fullReport });
  writeFederationOutputs(federationInfo, fedOptions);
  return federationInfo;
}
