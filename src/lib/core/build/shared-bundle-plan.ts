import type { NormalizedFederationConfig } from '../../domain/config/federation-config.contract.js';
import type { NormalizedExternalConfig } from '../../domain/config/external-config.contract.js';
import { inferPackageFromSecondary, normalizePackageName } from '../../utils/normalize.js';
import { logger } from '../../utils/logger.js';

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

export function splitShared(shared: Record<string, NormalizedExternalConfig>): SplitSharedResult {
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

interface SeparateGroup {
  entries: Record<string, NormalizedExternalConfig>;
  chunks?: { value: boolean; setBy: string };
}

function planSeparate(
  separate: Record<string, NormalizedExternalConfig>,
  platform: 'browser' | 'node',
  externals: string[],
  globalChunks: boolean
): SharedBundlePlan[] {
  const grouped: Record<string, SeparateGroup> = {};

  for (const [key, shared] of Object.entries(separate)) {
    const packageName = shared.build === 'separate' ? key : inferPackageFromSecondary(key);
    const group = (grouped[packageName] ??= { entries: {} });
    group.entries[key] = shared;
    if (shared.chunks !== undefined) {
      group.chunks = agreeOnChunks(group, bundleNameFor(platform, packageName), shared.chunks, key);
    }
  }

  return Object.entries(grouped).map(([packageName, group]) => ({
    bundleName: bundleNameFor(platform, packageName),
    platform,
    chunks: group.chunks?.value ?? globalChunks,
    entries: group.entries,
    // The package and its own subpaths are what this bundle builds; 'react-dom' is not 'react's.
    externals: externals.filter(e => e !== packageName && !e.startsWith(packageName + '/')),
    keys: Object.keys(group.entries),
    kind: 'separate',
  }));
}

const bundleNameFor = (platform: 'browser' | 'node', packageName: string): string =>
  `${platform}-${normalizePackageName(packageName)}`;

// `chunks` is set per bundle; an external that leaves it out takes whatever the others set.
// Until 5.0 a disagreement warns and the first value wins.
function agreeOnChunks(
  group: SeparateGroup,
  bundleName: string,
  value: boolean,
  key: string
): SeparateGroup['chunks'] {
  const agreed = group.chunks;
  if (!agreed) return { value, setBy: key };
  if (agreed.value !== value) {
    logger.warn(
      `Shared externals '${agreed.setBy}' (chunks: ${agreed.value}) and '${key}' ` +
        `(chunks: ${value}) are built in one bundle, '${bundleName}', which can only take one ` +
        `chunks setting, so '${agreed.setBy}' wins. Set the same value on both.`
    );
  }
  return agreed;
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

  plans.push(...planSeparate(separateBrowser, 'browser', externals, config.chunks));
  plans.push(...planSeparate(separateServer, 'node', externals, config.chunks));

  return plans;
}
