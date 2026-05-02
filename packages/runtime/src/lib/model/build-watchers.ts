import { globalCache } from './global-cache.js';

const watchedBuildEndpoints = globalCache.watchedBuildEndpoints;

/**
 * Registry of build-notification endpoints (SSE URLs) that already have an
 * active watcher. Used to deduplicate `EventSource` subscriptions when
 * multiple remotes resolve to the same physical endpoint.
 */

export function hasBuildWatcher(endpoint: string): boolean {
  return watchedBuildEndpoints.has(endpoint);
}

export function registerBuildWatcher(endpoint: string): void {
  watchedBuildEndpoints.add(endpoint);
}

export function unregisterBuildWatcher(endpoint: string): void {
  watchedBuildEndpoints.delete(endpoint);
}
