import type { BuildNotificationOptions } from './build-notification-options.contract.js';

export interface FederationOptions {
  workspaceRoot: string;
  outputPath: string;
  federationConfig: string;
  cacheExternalArtifacts?: boolean;
  chunking?: boolean | { enable: boolean; legacy?: boolean };
  tsConfig?: string;
  verbose?: boolean;
  dev?: boolean;
  watch?: boolean;
  packageJson?: string;
  entryPoint?: string;
  buildNotifications?: BuildNotificationOptions;
}
