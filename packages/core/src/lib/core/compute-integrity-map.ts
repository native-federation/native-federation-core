import * as path from 'path';
import * as fs from 'fs';
import type { FederationInfo, IntegrityMap } from '../domain/core/federation-info.contract.js';
import type { FederationOptions } from '../domain/core/federation-options.contract.js';
import { integrityForFile } from '../utils/hash-file.js';

export function computeIntegrityMap(
  federationInfo: FederationInfo,
  fedOptions: FederationOptions
): IntegrityMap {
  const outputDir = path.join(fedOptions.workspaceRoot, fedOptions.outputPath);
  const integrity: IntegrityMap = {};

  const addFile = (fileName: string | undefined) => {
    if (!fileName || integrity[fileName]) return;
    const filePath = path.join(outputDir, fileName);
    if (!fs.existsSync(filePath)) return;
    integrity[fileName] = integrityForFile(filePath);
  };

  for (const shared of federationInfo.shared) addFile(shared.outFileName);
  for (const exposed of federationInfo.exposes) addFile(exposed.outFileName);
  if (federationInfo.chunks) {
    for (const chunkFiles of Object.values(federationInfo.chunks)) {
      for (const file of chunkFiles) addFile(file);
    }
  }

  return integrity;
}
