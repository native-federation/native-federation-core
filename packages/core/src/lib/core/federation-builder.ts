import type { FederationInfo } from '../domain/core/federation-info.contract.js';
import { getConfigContext, usePackageJson, useWorkspace } from '../config/configuration-context.js';
import type { NormalizedFederationConfig } from '../domain/config/federation-config.contract.js';
import { getBuildAdapter, setBuildAdapter } from './build-adapter.js';
import { buildForFederation } from './build-for-federation.js';
import {
  type FederationOptions,
  type NormalizedFederationOptions,
} from '../domain/core/federation-options.contract.js';
import { getExternals } from './get-externals.js';
import { normalizeFederationOptions } from './normalize-options.js';
import type { NFBuildAdapter } from '../domain/core/build-adapter.contract.js';
import { rebuildForFederation } from './rebuild-for-federation.js';

export interface BuildHelperParams {
  options: FederationOptions;
  adapter: NFBuildAdapter;
}

let externals: string[] = [];
let config: NormalizedFederationConfig;
let options: NormalizedFederationOptions;
let fedInfo: FederationInfo;

async function init(params: BuildHelperParams): Promise<void> {
  setBuildAdapter(params.adapter);
  useWorkspace(params.options.workspaceRoot);
  usePackageJson(params.options.packageJson);
  params.options.workspaceRoot = getConfigContext().workspaceRoot ?? params.options.workspaceRoot;

  const normalized = await normalizeFederationOptions(params.options);

  options = normalized.options;
  config = normalized.config;

  externals = getExternals(config);
}

async function build(opts: { modifiedFiles?: string[]; signal?: AbortSignal } = {}): Promise<void> {
  if (!fedInfo) {
    fedInfo = await buildForFederation(config, options, externals, opts.signal);
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
  get externals(): string[] {
    return externals;
  },
  get config(): NormalizedFederationConfig {
    return config;
  },
};
