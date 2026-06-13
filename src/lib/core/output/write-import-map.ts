import * as path from 'path';
import type {
  ChunkInfo,
  IntegrityMap,
  SharedInfo,
} from '../../domain/core/federation-info.contract.js';
import type { FileWriterPort } from '../../domain/utils/io-port.contract.js';
import type { FederationOptions } from '../../domain/core/federation-options.contract.js';
import { toChunkImport } from '../../domain/core/chunk.js';
import { nodeIo } from '../../utils/io/node-io-adapter.js';

export function writeImportMapCore(
  io: FileWriterPort,
  sharedInfo: { externals: SharedInfo[]; chunks?: ChunkInfo },
  fedOption: FederationOptions,
  fileIntegrity?: IntegrityMap
) {
  const imports = sharedInfo.externals.reduce(
    (acc, cur) => {
      return {
        ...acc,
        [cur.packageName]: cur.outFileName,
      };
    },
    {} as Record<string, string>
  );
  if (sharedInfo.chunks) {
    Object.values(sharedInfo.chunks).forEach(c => {
      c.forEach(e => {
        const key: string = toChunkImport(e);
        imports[key] = e;
      });
    });
  }

  const importMap: { imports: Record<string, string>; integrity?: IntegrityMap } = { imports };

  if (fileIntegrity) {
    const integrity: IntegrityMap = {};
    for (const url of Object.values(imports)) {
      const sri = fileIntegrity[url];
      if (sri) integrity[url] = sri;
    }
    if (Object.keys(integrity).length > 0) {
      importMap.integrity = integrity;
    }
  }

  const importMapPath = path.join(fedOption.workspaceRoot, fedOption.outputPath, 'importmap.json');
  io.writeText(importMapPath, JSON.stringify(importMap, null, 2));
}

export function writeImportMap(
  sharedInfo: { externals: SharedInfo[]; chunks?: ChunkInfo },
  fedOption: FederationOptions,
  fileIntegrity?: IntegrityMap
) {
  writeImportMapCore(nodeIo, sharedInfo, fedOption, fileIntegrity);
}
