import type { FederationInfo } from '../domain/core/federation-info.contract.js';
import * as fs from 'fs';
import * as path from 'path';
import type { FederationOptions } from '../domain/core/federation-options.contract.js';

export function writeFederationInfo(federationInfo: FederationInfo, fedOptions: FederationOptions) {
  const metaDataPath = path.join(
    fedOptions.workspaceRoot,
    fedOptions.outputPath,
    'remoteEntry.json'
  );
  fs.writeFileSync(metaDataPath, JSON.stringify(federationInfo, null, 2));
}
