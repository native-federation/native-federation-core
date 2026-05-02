import { beforeEach, describe, expect, it } from 'vitest';
import {
  hasBuildWatcher,
  registerBuildWatcher,
  unregisterBuildWatcher,
} from './build-watchers.js';
import { globalCache } from './global-cache.js';

describe('build-watchers', () => {
  const endpoint = 'http://localhost:4201/build-notifications';

  beforeEach(() => {
    globalCache.watchedBuildEndpoints.clear();
  });

  describe('registerBuildWatcher', () => {
    it('marks the endpoint as watched', () => {
      registerBuildWatcher(endpoint);

      expect(hasBuildWatcher(endpoint)).toBe(true);
    });

    it('is idempotent for the same endpoint', () => {
      registerBuildWatcher(endpoint);
      registerBuildWatcher(endpoint);

      expect(globalCache.watchedBuildEndpoints.size).toBe(1);
    });

    it('tracks distinct endpoints independently', () => {
      const otherEndpoint = 'http://localhost:4202/build-notifications';

      registerBuildWatcher(endpoint);
      registerBuildWatcher(otherEndpoint);

      expect(globalCache.watchedBuildEndpoints.size).toBe(2);
      expect(hasBuildWatcher(endpoint)).toBe(true);
      expect(hasBuildWatcher(otherEndpoint)).toBe(true);
    });
  });

  describe('hasBuildWatcher', () => {
    it('returns false for unknown endpoints', () => {
      expect(hasBuildWatcher(endpoint)).toBe(false);
    });
  });

  describe('unregisterBuildWatcher', () => {
    it('removes a previously registered endpoint', () => {
      registerBuildWatcher(endpoint);
      unregisterBuildWatcher(endpoint);

      expect(hasBuildWatcher(endpoint)).toBe(false);
    });

    it('is a no-op for unknown endpoints', () => {
      expect(() => unregisterBuildWatcher(endpoint)).not.toThrow();
      expect(hasBuildWatcher(endpoint)).toBe(false);
    });
  });
});
