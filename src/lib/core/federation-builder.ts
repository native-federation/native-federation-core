import type { FederationInfo, OutputFile } from '../domain/core/federation-info.contract.js';
import type { NormalizedFederationConfig } from '../domain/config/federation-config.contract.js';
import { getBuildAdapter, setBuildAdapter } from './build/build-adapter.js';
import { buildForFederation } from './build/build-for-federation.js';
import {
  type FederationOptions,
  type NormalizedFederationOptions,
} from '../domain/core/federation-options.contract.js';
import { getExternals } from './build/get-externals.js';
import { normalizeFederationOptions } from './normalize-options.js';
import type { NFBuildAdapter } from '../domain/core/build-adapter.contract.js';
import { rebuildForFederation } from './build/rebuild-for-federation.js';
import { collectOutputFiles } from './cache/federation-cache.js';
import type { FederationCache } from '../domain/core/federation-cache.contract.js';

export interface BuildHelperParams {
  options: FederationOptions;
  adapter: NFBuildAdapter;
}

let externals: string[] = [];
let config: NormalizedFederationConfig;
let options: NormalizedFederationOptions;
let fedInfo: FederationInfo;
let builtCache: FederationCache | undefined;

async function init(params: BuildHelperParams): Promise<void> {
  const normalized = await normalizeFederationOptions(params.options, undefined, {
    externals: params.adapter.externals,
  });

  setBuildAdapter(params.adapter);

  options = normalized.options;
  config = normalized.config;

  externals = getExternals(config);
}

async function build(opts: { modifiedFiles?: string[]; signal?: AbortSignal } = {}): Promise<void> {
  if (builtCache !== options.federationCache) {
    const cache = options.federationCache;
    fedInfo = await buildForFederation(config, options, externals, opts.signal);
    builtCache = cache;
  } else {
    fedInfo = await rebuildForFederation(
      config,
      options,
      externals,
      opts.modifiedFiles ?? [],
      opts.signal
    );
  }
}

async function close(): Promise<void> {
  return getBuildAdapter().dispose();
}

export const federationBuilder = {
  init,
  build,
  close,
  get federationInfo() {
    return fedInfo;
  },
  get outputFiles(): OutputFile[] | undefined {
    return options && collectOutputFiles(options.federationCache);
  },
  get externals(): string[] {
    return externals;
  },
  get config(): NormalizedFederationConfig {
    return config;
  },
  get options(): NormalizedFederationOptions {
    return options;
  },
};
