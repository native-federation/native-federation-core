import type { FederationCache } from '../../domain.js';
import type {
  FederationOptions,
  NormalizedFederationOptions,
} from '../domain/core/federation-options.contract.js';
import { getDefaultCachePath } from '../utils/cache-persistence.js';
import { createFederationCache } from './federation-cache.js';

export function normalizeFederationOptions(
  options: FederationOptions
): NormalizedFederationOptions<undefined>;
export function normalizeFederationOptions<TBundlerCache>(
  options: FederationOptions,
  cache: FederationCache<TBundlerCache>
): NormalizedFederationOptions<TBundlerCache>;
export function normalizeFederationOptions<TBundlerCache = undefined>(
  options: FederationOptions,
  cache?: FederationCache<TBundlerCache>
): NormalizedFederationOptions<TBundlerCache> {
  const federationCache =
    cache ??
    (createFederationCache(
      getDefaultCachePath(options.workspaceRoot)
    ) as FederationCache<TBundlerCache>);
  return {
    ...options,
    federationCache,
  };
}
