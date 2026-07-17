import type { NormalizedFederationConfig } from '../../domain/config/federation-config.contract.js';
import type { NormalizedExternalConfig } from '../../domain/config/external-config.contract.js';
import { inferPackageFromSecondary, normalizePackageName } from '../../utils/normalize.js';

export interface SharedBundlePlan {
  bundleName: string;
  platform: 'browser' | 'node';
  chunks: boolean;
  entries: Record<string, NormalizedExternalConfig>;
  externals: string[];
  keys: string[];
  kind: 'shared' | 'separate';
}

type SplitSharedResult = {
  sharedServer: Record<string, NormalizedExternalConfig>;
  sharedBrowser: Record<string, NormalizedExternalConfig>;
  separateBrowser: Record<string, NormalizedExternalConfig>;
  separateServer: Record<string, NormalizedExternalConfig>;
};

export function splitShared(
  shared: Record<string, NormalizedExternalConfig>
): SplitSharedResult {
  const sharedServer: Record<string, NormalizedExternalConfig> = {};
  const sharedBrowser: Record<string, NormalizedExternalConfig> = {};
  const separateBrowser: Record<string, NormalizedExternalConfig> = {};
  const separateServer: Record<string, NormalizedExternalConfig> = {};

  for (const key in shared) {
    const obj = shared[key];
    if (obj?.platform === 'node') {
      if (obj.build === 'default') sharedServer[key] = obj;
      else separateServer[key] = obj;
    } else if (obj?.platform === 'browser') {
      if (obj.build === 'default') sharedBrowser[key] = obj;
      else separateBrowser[key] = obj;
    }
  }

  return { sharedBrowser, sharedServer, separateBrowser, separateServer };
}

function planSeparate(
  separate: Record<string, NormalizedExternalConfig>,
  platform: 'browser' | 'node',
  externals: string[]
): SharedBundlePlan[] {
  const grouped: Record<
    string,
    { entries: Record<string, NormalizedExternalConfig>; chunks: boolean }
  > = {};

  for (const [key, shared] of Object.entries(separate)) {
    const packageName = shared.build === 'separate' ? key : inferPackageFromSecondary(key);
    if (!grouped[packageName]) grouped[packageName] = { chunks: shared.chunks, entries: {} };
    grouped[packageName].entries[key] = shared;
  }

  return Object.entries(grouped).map(([packageName, group]) => ({
    bundleName: `${platform}-${normalizePackageName(packageName)}`,
    platform,
    chunks: group.chunks,
    entries: group.entries,
    externals: externals.filter(e => !e.startsWith(packageName)),
    keys: Object.keys(group.entries),
    kind: 'separate',
  }));
}

/** Single source of truth for package → bundle(name) mapping, shared by the initial
 *  build and the watch rebuild so both target the same cache entries. */
export function planSharedBundles(
  config: NormalizedFederationConfig,
  externals: string[]
): SharedBundlePlan[] {
  const { sharedBrowser, sharedServer, separateBrowser, separateServer } = splitShared(
    config.shared
  );

  const plans: SharedBundlePlan[] = [];

  if (Object.keys(sharedBrowser).length > 0) {
    plans.push({
      bundleName: 'browser-shared',
      platform: 'browser',
      chunks: config.chunks,
      entries: sharedBrowser,
      externals,
      keys: Object.keys(sharedBrowser),
      kind: 'shared',
    });
  }
  if (Object.keys(sharedServer).length > 0) {
    plans.push({
      bundleName: 'node-shared',
      platform: 'node',
      chunks: config.chunks,
      entries: sharedServer,
      externals,
      keys: Object.keys(sharedServer),
      kind: 'shared',
    });
  }

  plans.push(...planSeparate(separateBrowser, 'browser', externals));
  plans.push(...planSeparate(separateServer, 'node', externals));

  return plans;
}
