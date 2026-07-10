import * as path from 'path';
import { DEFAULT_SKIP_LIST, isInSkipList, prepareSkipList } from './default-skip-list.js';
import { type SkipList } from '../domain/config/skip-list.contract.js';
import {
  sharedPackageJsonRepository,
  findDepPackageJson,
  getVersionMaps,
} from '../utils/package/package-info.js';
import type { PackageJsonRepository } from '../domain/utils/package-json.contract.js';
import { logger } from '../utils/logger.js';
import { nodeIo } from '../utils/io/node-io-adapter.js';
import type { FileReaderPort, GlobPort } from '../domain/utils/io-port.contract.js';
import type {
  ExternalConfig,
  IncludeSecondariesOptions,
  ResolvedSharedExternalsConfig,
  ShareAllExternalsOptions,
  SharedExternalsConfig,
  ShareExternalsOptions,
} from '../domain/config/external-config.contract.js';
import { findPackageJson, inferProjectPath } from './project-paths.js';
import { isInferVersion, lookupVersion } from './version-lookup.js';
import { addSecondaries, getSecondaries } from './secondaries.js';

export const fromPackageJson = (baseCfg: ShareAllExternalsOptions, projectPath?: string) => {
  const skipList: SkipList = [...DEFAULT_SKIP_LIST];
  let overrides: ShareExternalsOptions = {};
  const patchList: Record<string, Partial<ExternalConfig>> = {};

  const builder = {
    skip(externals: SkipList) {
      skipList.push(...externals);
      return builder;
    },
    override(externals: ShareExternalsOptions) {
      overrides = { ...overrides, ...externals };
      return builder;
    },
    patch(externals: string[], cfg: Partial<ExternalConfig>) {
      externals.forEach(external => {
        patchList[external] = {
          ...(patchList[external] ?? {}),
          ...cfg,
        };
      });
      return builder;
    },
    get() {
      return shareAllCore(nodeIo, baseCfg, {
        skipList,
        projectPath,
        overrides,
        patchList,
      });
    },
  };

  return builder;
};

export function shareAll(
  config: ShareAllExternalsOptions,
  opts: {
    skipList?: SkipList;
    projectPath?: string;
    overrides?: ShareExternalsOptions;
  } = {}
): ResolvedSharedExternalsConfig {
  return shareAllCore(nodeIo, config, opts);
}

export function shareAllCore(
  io: FileReaderPort & GlobPort,
  config: ShareAllExternalsOptions,
  opts: {
    skipList?: SkipList;
    projectPath?: string;
    overrides?: ShareExternalsOptions;
    patchList?: Record<string, Partial<ExternalConfig>>;
  } = {},
  repo: PackageJsonRepository = sharedPackageJsonRepository
): ResolvedSharedExternalsConfig {
  const projectPath = inferProjectPath(opts.projectPath);

  const versionMaps = getVersionMaps(projectPath, projectPath, repo);
  const sharedExternals: ShareExternalsOptions = {};
  const skipList = opts.skipList ?? DEFAULT_SKIP_LIST;

  for (const versions of versionMaps) {
    for (const key in versions) {
      if (isInSkipList(key, prepareSkipList(skipList))) {
        continue;
      }
      if (!!opts.overrides && Object.keys(opts.overrides).some(o => key.startsWith(o))) {
        continue;
      }

      const inferVersion = !config.requiredVersion || config.requiredVersion === 'auto';
      const requiredVersion = inferVersion ? versions[key] : config.requiredVersion;

      if (!sharedExternals[key]) {
        sharedExternals[key] = { ...config, requiredVersion };
      }
    }
  }

  const finalExternalList = applyPatchList(sharedExternals, opts.patchList, opts.overrides);

  return {
    ...shareCore(io, finalExternalList, opts.projectPath, skipList, repo),
    ...(!opts.overrides ? {} : shareCore(io, opts.overrides, opts.projectPath, skipList, repo)),
  };
}

/**
 * Merges `patchList` overrides onto the shared externals. Patches only affect
 * externals that are actually being shared: a patch for an external that isn't
 * in the list (unknown dependency, skipped, or shadowed by `overrides`) is
 * ignored with a warning.
 */
function applyPatchList(
  sharedExternals: ShareExternalsOptions,
  patchList: Record<string, Partial<ExternalConfig>> | undefined,
  overrides: ShareExternalsOptions | undefined
): ShareExternalsOptions {
  if (!patchList) {
    return sharedExternals;
  }

  const result = { ...sharedExternals };

  for (const [external, cfg] of Object.entries(patchList)) {
    if (!result[external]) {
      const shadowedByOverride =
        !!overrides && Object.keys(overrides).some(o => external.startsWith(o));
      logger.warn(
        shadowedByOverride
          ? `Ignoring patch for '${external}': it is already configured via 'overrides' ('patch' and 'overrides' are mutually exclusive per external).`
          : `Ignoring patch for '${external}': it is not a shared external (unknown dependency or skipped).`
      );
      continue;
    }

    result[external] = { ...result[external], ...cfg };
  }

  return result;
}

export function share(
  configuredShareObjects: ShareExternalsOptions,
  projectPath = '',
  skipList = DEFAULT_SKIP_LIST
): ResolvedSharedExternalsConfig {
  return shareCore(nodeIo, configuredShareObjects, projectPath, skipList);
}

export function shareCore(
  io: FileReaderPort & GlobPort,
  configuredShareObjects: ShareExternalsOptions,
  projectPath = '',
  skipList = DEFAULT_SKIP_LIST,
  repo: PackageJsonRepository = sharedPackageJsonRepository
): ResolvedSharedExternalsConfig {
  projectPath = inferProjectPath(projectPath);
  const packagePath = findPackageJson(io, projectPath);

  const preparedSkipList = prepareSkipList(skipList);

  const shareObjects = { ...configuredShareObjects };

  const result: SharedExternalsConfig = {};

  for (const key in shareObjects) {
    let includeSecondaries: IncludeSecondariesOptions = false;
    const shareObject = shareObjects[key]!;

    if (
      shareObject.requiredVersion === 'auto' ||
      (isInferVersion() && typeof shareObject.requiredVersion === 'undefined') ||
      (shareObject.requiredVersion?.length ?? 1) < 1
    ) {
      const version = lookupVersion(key, projectPath, repo);

      shareObject.requiredVersion = version;
      shareObject.version = version.replace(/^\D*/, '');
    }

    if (typeof shareObject.includeSecondaries === 'undefined') {
      shareObject.includeSecondaries = true;
    }

    if (shareObject.includeSecondaries) {
      includeSecondaries = shareObject.includeSecondaries;
      delete shareObject.includeSecondaries;
      if (typeof includeSecondaries === 'object' && includeSecondaries.keepAll) {
        shareObject.includeSecondaries = true;
      }
    }

    result[key] = shareObject;

    if (includeSecondaries) {
      const libPackageJson = findDepPackageJson(key, path.dirname(packagePath), repo);

      if (!libPackageJson) {
        logger.error('Could not find folder containing dep ' + key);
        continue;
      }

      const libPath = path.dirname(libPackageJson);

      const secondaries = getSecondaries(
        io,
        includeSecondaries,
        libPath,
        key,
        shareObject,
        preparedSkipList
      );
      if (secondaries) {
        addSecondaries(secondaries, result);
      }
    }
  }

  return result as ResolvedSharedExternalsConfig;
}
