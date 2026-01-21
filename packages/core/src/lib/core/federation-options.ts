import type { BuildNotificationOptions } from '../domain/build-notification-options.contract.js';

export interface FederationOptions {
  workspaceRoot: string;
  outputPath: string;
  federationConfig: string;
  cacheExternalArtifacts?: boolean;
  tsConfig?: string;
  verbose?: boolean;
  dev?: boolean;
  watch?: boolean;
  packageJson?: string;
  entryPoint?: string;
  buildNotifications?: BuildNotificationOptions;
}
