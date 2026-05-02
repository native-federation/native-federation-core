import { BuildNotificationType } from '@softarc/native-federation/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { globalCache } from './model/global-cache.js';
import { watchFederationBuildCompletion } from './watch-federation-build.js';

describe('watch-federation-build', () => {
  let fakeReload: ReturnType<typeof vi.fn>;
  let mockConsoleLog: any;
  let mockConsoleWarn: any;
  let eventSourceInstance: any;
  let eventSourceFactory: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    globalCache.watchedBuildEndpoints.clear();

    fakeReload = vi.fn();
    vi.stubGlobal('window', { location: { reload: fakeReload } });

    mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockConsoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    eventSourceInstance = {
      onmessage: null,
      onerror: null,
      readyState: 1,
    };
    // Use a real (constructable) function so the production code can call it
    // with `new EventSource(...)`.
    eventSourceFactory = vi.fn(function (this: any) {
      return eventSourceInstance;
    });
    // Mirror the real `EventSource.CLOSED` constant used by the implementation.
    (eventSourceFactory as unknown as { CLOSED: number }).CLOSED = 2;
    vi.stubGlobal('EventSource', eventSourceFactory);
  });

  describe('watchFederationBuildCompletion', () => {
    it('reloads page when build completion is received', () => {
      watchFederationBuildCompletion('http://localhost:4200/build-notifications');

      eventSourceInstance.onmessage({
        data: JSON.stringify({ type: BuildNotificationType.COMPLETED }),
      });

      expect(mockConsoleLog).toHaveBeenCalledWith('[Federation] Rebuild completed, reloading...');
      expect(fakeReload).toHaveBeenCalled();
    });

    it('does not reload page for non-completion messages', () => {
      watchFederationBuildCompletion('http://localhost:4200/build-notifications');

      eventSourceInstance.onmessage({
        data: JSON.stringify({ type: BuildNotificationType.ERROR }),
      });

      expect(fakeReload).not.toHaveBeenCalled();
    });

    it('logs warning on SSE connection error', () => {
      watchFederationBuildCompletion('http://localhost:4200/build-notifications');

      const errorEvent = {};
      eventSourceInstance.onerror(errorEvent);

      expect(mockConsoleWarn).toHaveBeenCalledWith(
        '[Federation] SSE connection error:',
        errorEvent
      );
    });

    it('opens only one EventSource per endpoint when called multiple times', () => {
      const endpoint = 'http://localhost:4201/build-notifications';

      watchFederationBuildCompletion(endpoint);
      watchFederationBuildCompletion(endpoint);
      watchFederationBuildCompletion(endpoint);

      expect(eventSourceFactory).toHaveBeenCalledTimes(1);
      expect(eventSourceFactory).toHaveBeenCalledWith(endpoint);
    });

    it('opens an EventSource per distinct endpoint', () => {
      watchFederationBuildCompletion('http://localhost:4201/build-notifications');
      watchFederationBuildCompletion('http://localhost:4202/build-notifications');

      expect(eventSourceFactory).toHaveBeenCalledTimes(2);
    });

    it('frees the watcher slot when the SSE connection is closed permanently', () => {
      const endpoint = 'http://localhost:4201/build-notifications';

      watchFederationBuildCompletion(endpoint);

      // Simulate the browser closing the connection (e.g. after the dev server
      // is shut down) and re-emitting an error event in CLOSED state.
      eventSourceInstance.readyState = 2; // EventSource.CLOSED
      eventSourceInstance.onerror({});

      // The factory closes over `eventSourceInstance`, so reassigning it makes
      // the next `new EventSource(...)` return a fresh stub instance.
      eventSourceInstance = {
        onmessage: null,
        onerror: null,
        readyState: 1,
      };

      watchFederationBuildCompletion(endpoint);

      expect(eventSourceFactory).toHaveBeenCalledTimes(2);
    });
  });
});
