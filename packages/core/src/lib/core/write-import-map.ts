import * as path from 'path';
import * as fs from 'fs';
import type { ChunkInfo, SharedInfo } from '../domain/core/federation-info.contract.js';
import type { FederationOptions } from '../domain/core/federation-options.contract.js';
import { toChunkImport } from '../domain/core/chunk.js';

export function writeImportMap(
  sharedInfo: { externals: SharedInfo[]; chunks?: ChunkInfo },
  fedOption: FederationOptions
) {
  const imports = sharedInfo.externals.reduce((acc, cur) => {
    return {
      ...acc,
      [cur.packageName]: cur.outFileName,
    };
  }, {} as Record<string, string>);
  if (sharedInfo.chunks) {
    Object.values(sharedInfo.chunks).forEach(c => {
      c.forEach(e => {
        const key: string = toChunkImport(e);
        imports[key] = e;
      });
    });
  }

  const importMap = { imports };
  const importMapPath = path.join(fedOption.workspaceRoot, fedOption.outputPath, 'importmap.json');
  fs.writeFileSync(importMapPath, JSON.stringify(importMap, null, 2));
}
