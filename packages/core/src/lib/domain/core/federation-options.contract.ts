import type { BuildNotificationOptions } from './build-notification-options.contract.js';
import type { FederationCache } from './federation-cache.contract.js';

export interface FederationOptions {
  workspaceRoot: string;
  outputPath: string;
  federationConfig: string;
  cacheExternalArtifacts?: boolean;
  chunks?: boolean | { enable: boolean; dense?: boolean };
  tsConfig?: string;
  verbose?: boolean;
  dev?: boolean;
  watch?: boolean;
  packageJson?: string;
  entryPoints?: string[];
  buildNotifications?: BuildNotificationOptions;
}

export interface NormalizedFederationOptions<TBundlerCache = unknown> extends FederationOptions {
  federationCache: FederationCache<TBundlerCache>;
  entryPoints: string[];
}
