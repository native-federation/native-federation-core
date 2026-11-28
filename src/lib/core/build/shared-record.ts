import * as path from 'path';
import type { NormalizedExternalConfig } from '../../domain/config/external-config.contract.js';
import type { SharedInfo } from '../../domain/core/federation-info.contract.js';
import type { PackageJsonRepository } from '../../domain/utils/package-json.contract.js';
import { getPackageInfo, type PackageInfo } from '../../utils/package/package-info.js';

export function sharedPackageInfos(
  sharedBundles: Record<string, NormalizedExternalConfig>,
  folder: string,
  repo: PackageJsonRepository,
  platform: 'browser' | 'node',
  resolvedVersions: Record<string, string>
): PackageInfo[] {
  const inferredPackageInfos = Object.keys(sharedBundles)
    .filter(packageName => !sharedBundles[packageName]?.packageInfo)
    .map(packageName => getPackageInfo(packageName, folder, repo, platform))
    .filter(pi => !!pi) as PackageInfo[];

  const configuredPackageInfos = Object.keys(sharedBundles)
    .filter(packageName => !!sharedBundles[packageName]?.packageInfo)
    .map(packageName => ({
      packageName,
      ...sharedBundles[packageName]?.packageInfo,
      // getChecksumCore falls back to the declared version the same way, so a hit replays this.
      version: resolvedVersions[packageName] || sharedBundles[packageName]?.version,
    })) as PackageInfo[];

  return [...inferredPackageInfos, ...configuredPackageInfos];
}

export function buildResult(
  packageInfos: PackageInfo[],
  sharedBundles: Record<string, NormalizedExternalConfig>,
  outFileNames: string[]
) {
  return packageInfos.map(pi => {
    const shared = sharedBundles[pi.packageName];
    return {
      packageName: pi.packageName,
      outFileName: path.basename(outFileNames.shift() || ''),
      requiredVersion: shared?.requiredVersion,
      singleton: shared?.singleton,
      strictVersion: shared?.strictVersion,
      version: pi.version,
      ...(shared?.shareScope && { shareScope: shared.shareScope }),
      ...(shared?.pool && { pool: shared.pool }),
      ...(shared?.preload && { preload: true }),
    } as SharedInfo;
  });
}
