import type { FederationInfo } from '../domain/core/federation-info.contract.js';
import { getConfigContext, usePackageJson, useWorkspace } from '../config/configuration-context.js';
import type { NormalizedFederationConfig } from '../domain/config/federation-config.contract.js';
import { setBuildAdapter } from './build-adapter.js';
import { buildForFederation } from './build-for-federation.js';
import { type FederationOptions } from '../domain/core/federation-options.contract.js';
import { getExternals } from './get-externals.js';
import { loadFederationConfig } from './load-federation-config.js';
import type { NFBuildAdapter } from '../domain/core/build-adapter.contract.js';

export interface BuildHelperParams {
  options: FederationOptions;
  adapter: NFBuildAdapter;
}

let externals: string[] = [];
let config: NormalizedFederationConfig;
let fedOptions: FederationOptions;
let fedInfo: FederationInfo;

async function init(params: BuildHelperParams): Promise<void> {
  setBuildAdapter(params.adapter);
  fedOptions = params.options;
  useWorkspace(params.options.workspaceRoot);
  usePackageJson(params.options.packageJson);
  config = await loadFederationConfig(fedOptions);
  params.options.workspaceRoot = getConfigContext().workspaceRoot ?? params.options.workspaceRoot;
  externals = getExternals(config);
}

async function build(signal?: AbortSignal): Promise<void> {
  fedInfo = await buildForFederation(config, fedOptions, externals, signal);
}

export const federationBuilder = {
  init,
  build,
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
