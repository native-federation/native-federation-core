import path from 'path';

import type { SharedInfo } from '../../domain/core/federation-info.contract.js';
import type { FileReaderPort } from '../../domain/utils/io-port.contract.js';
import type { NormalizedFederationConfig } from '../../domain/config/federation-config.contract.js';
import { type NormalizedFederationOptions } from '../../domain/core/federation-options.contract.js';
import type { AutoRequiredOptions } from '../../domain/config/external-config.contract.js';
import { logger } from '../../utils/logger.js';
import { resolveMappingConfig } from '../../config/mapping-utils.js';
import { applyAutoRequiredOptions } from '../../config/version-lookup.js';

export type MappingRecord = Omit<SharedInfo, 'packageName' | 'outFileName' | 'dev'>;

export function mappingRecord(
  io: FileReaderPort,
  mappedPath: string,
  mappedImport: string,
  config: NormalizedFederationConfig,
  fedOptions: NormalizedFederationOptions
): MappingRecord {
  const mappingVersion = config.features.mappingVersion
    ? getMappingVersionCore(io, mappedPath, fedOptions.workspaceRoot)
    : '';

  const mappingConfig = resolveMappingConfig(mappedImport, config);
  const requiredVersionCfg = mappingConfig.requiredVersion;
  // An explicit version drives requiredVersion too, the same way the detected one does.
  const explicitVersion =
    requiredVersionCfg && typeof requiredVersionCfg === 'object'
      ? requiredVersionCfg.version
      : undefined;
  const asked = explicitVersion && explicitVersion !== 'auto' ? explicitVersion : undefined;
  const version = asked ?? mappingConfig.version ?? mappingVersion;

  return {
    requiredVersion: mappingRequiredVersion(requiredVersionCfg, version),
    singleton: mappingConfig.singleton,
    strictVersion: mappingConfig.strictVersion,
    version,
    ...(mappingConfig.shareScope && { shareScope: mappingConfig.shareScope }),
    ...(mappingConfig.pool && { pool: mappingConfig.pool }),
  };
}

// '~' stays the default range for a mapping; see README 'Configuring shared mappings'.
function mappingRequiredVersion(
  cfg: string | AutoRequiredOptions | undefined,
  version: string
): string {
  if (typeof cfg === 'string') return cfg;
  if (version.length === 0) return '';
  return applyAutoRequiredOptions(version, { range: cfg?.range ?? '~' });
}

export function getMappingVersionCore(
  io: FileReaderPort,
  fileName: string,
  workspaceRoot: string
): string {
  const resolvedRoot = path.resolve(workspaceRoot);
  let dir = path.dirname(path.resolve(fileName));

  while (true) {
    const candidate = path.join(dir, 'package.json');
    if (io.isFile(candidate)) {
      try {
        const json = JSON.parse(io.readText(candidate));
        if (typeof json.version === 'string' && json.version) return json.version;
      } catch (err: unknown) {
        logger.warn(`[getMappingVersion] Failed to parse ${candidate}: ${(err as Error).message}`);
      }
    }
    const parent = path.dirname(dir);
    if (dir === resolvedRoot || parent === dir) return '';
    dir = parent;
  }
}
