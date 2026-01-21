import type { FederationInfo } from './../domain/federation-info.contract.js';
import { getConfigContext, usePackageJson, useWorkspace } from '../config/configuration-context.js';
import type { NormalizedFederationConfig } from '../config/federation-config.contract.js';
import { type BuildAdapter, setBuildAdapter } from './build-adapter.js';
import { buildForFederation, defaultBuildParams } from './build-for-federation.js';
import { type FederationOptions } from './federation-options.js';
import { getExternals } from './get-externals.js';
import { loadFederationConfig } from './load-federation-config.js';

export interface BuildHelperParams {
  options: FederationOptions;
  adapter: BuildAdapter;
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

async function build(buildParams = defaultBuildParams): Promise<void> {
  fedInfo = await buildForFederation(config, fedOptions, externals, buildParams);
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
