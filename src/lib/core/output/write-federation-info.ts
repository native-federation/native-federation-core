import type { FederationInfo } from '../../domain/core/federation-info.contract.js';
import * as path from 'path';
import type { FileWriterPort } from '../../domain/utils/io-port.contract.js';
import type { FederationOptions } from '../../domain/core/federation-options.contract.js';
import { nodeIo } from '../../utils/io/node-io-adapter.js';
import { resolveOutputPath } from '../../utils/output-path.js';

export function writeFederationInfoCore(
  io: FileWriterPort,
  federationInfo: FederationInfo,
  fedOptions: FederationOptions
) {
  const metaDataPath = path.join(resolveOutputPath(fedOptions), 'remoteEntry.json');
  io.writeText(metaDataPath, JSON.stringify({ $version: 'v4', ...federationInfo }, null, 2));
}

export function writeFederationInfo(federationInfo: FederationInfo, fedOptions: FederationOptions) {
  writeFederationInfoCore(nodeIo, federationInfo, fedOptions);
}
