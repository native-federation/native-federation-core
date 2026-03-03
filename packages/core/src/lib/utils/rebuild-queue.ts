import { logger } from './logger.js';

interface BuildControl {
  controller: AbortController;
  buildFinished: { resolve: () => void; promise: Promise<void> };
}

export type TrackResult<T = never> =
  | { type: 'completed'; result: { success: boolean; cancelled?: boolean } }
  | { type: 'interrupted'; value: T };

export class RebuildQueue {
  private activeBuilds: Map<number, BuildControl> = new Map();
  private buildCounter = 0;

  async track<T = never>(
    rebuildFn: (signal: AbortSignal) => Promise<{ success: boolean; cancelled?: boolean }>,
    interruptPromise?: Promise<T>
  ): Promise<TrackResult<T>> {
    const buildId = ++this.buildCounter;

    const pendingCancellations = Array.from(this.activeBuilds.values()).map(buildInfo => {
      buildInfo.controller.abort();
      return buildInfo.buildFinished.promise;
    });

    if (pendingCancellations.length > 0) {
      logger.info(`Aborting ${pendingCancellations.length} bundling task(s)..`);
    }

    if (pendingCancellations.length > 0) {
      await Promise.all(pendingCancellations);
    }

    let buildFinished: () => void;
    const completionPromise = new Promise<void>(resolve => {
      buildFinished = resolve;
    });

    const control: BuildControl = {
      controller: new AbortController(),
      buildFinished: {
        resolve: buildFinished!,
        promise: completionPromise,
      },
    };
    this.activeBuilds.set(buildId, control);

    const buildPromise = rebuildFn(control.controller.signal)
      .then(result => ({ type: 'completed' as const, result }))
      .catch(error => ({ type: 'completed' as const, result: { success: false, error } }));

    let trackResult: TrackResult<T>;

    try {
      if (interruptPromise) {
        const interruptRacer = interruptPromise.then(value => ({
          type: 'interrupted' as const,
          value,
        }));

        const raceResult = await Promise.race([buildPromise, interruptRacer]);

        if (raceResult.type === 'interrupted') {
          control.controller.abort();
          await buildPromise;
          trackResult = raceResult;
        } else {
          trackResult = raceResult;
        }
      } else {
        trackResult = await buildPromise;
      }
    } finally {
      control.buildFinished.resolve();
      this.activeBuilds.delete(buildId);
    }

    return trackResult;
  }

  dispose(): void {
    for (const [_, buildInfo] of this.activeBuilds) {
      buildInfo.controller.abort();
    }
    this.activeBuilds.clear();
  }
}
