import type { FederationInfo } from '../domain/federation-info.contract.js';
import * as fs from 'fs';
import * as path from 'path';
import type { FederationOptions } from './federation-options.js';

export function writeFederationInfo(federationInfo: FederationInfo, fedOptions: FederationOptions) {
  const metaDataPath = path.join(
    fedOptions.workspaceRoot,
    fedOptions.outputPath,
    'remoteEntry.json'
  );
  fs.writeFileSync(metaDataPath, JSON.stringify(federationInfo, null, 2));
}
