import type { NormalizedFederationConfig } from '../domain/config/federation-config.contract.js';
import type { FederationOptions } from '../domain/core/federation-options.contract.js';
import * as path from 'path';
import * as fs from 'fs';
import { pathToFileURL } from 'url';
import { removeUnusedDeps } from './remove-unused-deps.js';

export async function loadFederationConfig(
  fedOptions: FederationOptions
): Promise<NormalizedFederationConfig> {
  const fullConfigPath = path.join(fedOptions.workspaceRoot, fedOptions.federationConfig);

  if (!fs.existsSync(fullConfigPath)) {
    throw new Error('Expected ' + fullConfigPath);
  }

  const config: NormalizedFederationConfig = (await import(pathToFileURL(fullConfigPath).href))
    ?.default;

  if (config.features.ignoreUnusedDeps && !fedOptions.entryPoint) {
    throw new Error(
      `The feature ignoreUnusedDeps needs the application's entry point. Please set it in your federation options!`
    );
  }

  if (config.features.ignoreUnusedDeps) {
    return removeUnusedDeps(config, fedOptions.entryPoint ?? '', fedOptions.workspaceRoot);
  }

  return config;
}
