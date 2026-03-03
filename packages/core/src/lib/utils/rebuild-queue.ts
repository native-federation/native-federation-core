import { logger } from './logger.js';

interface BuildControl {
  controller: AbortController;
  buildFinished: { resolve: () => void; promise: Promise<void> };
}

export class RebuildQueue {
  private activeBuilds: Map<number, BuildControl> = new Map();
  private buildCounter = 0;

  async track(
    rebuildFn: (signal: AbortSignal) => Promise<{ success: boolean; cancelled?: boolean }>
  ): Promise<{ success: boolean; cancelled?: boolean }> {
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

    let status = { success: false };
    try {
      status = await rebuildFn(control.controller.signal);
    } finally {
      control.buildFinished.resolve();
      this.activeBuilds.delete(buildId);
    }
    return status;
  }

  dispose(): void {
    for (const [_, buildInfo] of this.activeBuilds) {
      buildInfo.controller.abort();
    }
    this.activeBuilds.clear();
  }
}
