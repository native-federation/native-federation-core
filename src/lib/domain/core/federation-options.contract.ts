import type { BuildNotificationOptions } from './build-notification-options.contract.js';
import type { FederationCache } from './federation-cache.contract.js';

export interface FederationOptions {
  workspaceRoot: string;
  outputPath: string;
  federationConfig: string;
  projectName?: string;
  cacheExternalArtifacts?: boolean;
  tsConfig?: string;
  verbose?: boolean;
  dev?: boolean;
  watch?: boolean;
  /** Poll-watch npm-linked shared deps so a rebuild of the linked lib live-reloads the
   *  host. Off by default: a registry dep is bundled once and cached by checksum, so
   *  watching node_modules can never change an outcome, and the walk costs real CPU for
   *  as long as the dev server runs. Checksums track linked content either way, so with
   *  this off a linked lib still re-bundles on the next build — it just is not live. */
  watchLinkedDeps?: boolean;
  packageJson?: string;
  entryPoints?: string[];
  buildNotifications?: BuildNotificationOptions;
}

export interface NormalizedFederationOptions<TBundlerCache = unknown> extends FederationOptions {
  federationCache: FederationCache<TBundlerCache>;
  entryPoints: string[];
  projectName: string;
  cacheExternalArtifacts: boolean;
  watchLinkedDeps: boolean;
}
