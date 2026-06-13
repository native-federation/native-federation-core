import { afterEach, describe, expect, it, vi } from 'vitest';
import { RebuildQueue } from './rebuild-queue.js';
import { logger } from '../utils/logger.js';

/** A rebuild that only settles once its abort signal fires. */
const abortable =
  (onAbort?: () => void) =>
  (signal: AbortSignal): Promise<{ success: boolean; cancelled?: boolean }> =>
    new Promise(resolve => {
      signal.addEventListener('abort', () => {
        onAbort?.();
        resolve({ success: false, cancelled: true });
      });
    });

describe('RebuildQueue', () => {
  afterEach(() => vi.restoreAllMocks());

  it('completes a single build', async () => {
    const result = await new RebuildQueue().track(async () => ({ success: true }));
    expect(result).toEqual({ type: 'completed', result: { success: true } });
  });

  it('maps a rejected rebuild to a failed completion', async () => {
    const result = await new RebuildQueue().track(async () => {
      throw new Error('boom');
    });
    expect(result).toMatchObject({ type: 'completed', result: { success: false } });
  });

  it('aborts an in-flight build when a new one is tracked', async () => {
    const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    const queue = new RebuildQueue();
    let aborted = false;

    const first = queue.track(abortable(() => (aborted = true)));
    const second = await queue.track(async () => ({ success: true }));

    expect(second).toEqual({ type: 'completed', result: { success: true } });
    expect(aborted).toBe(true);
    expect(info).toHaveBeenCalledWith(expect.stringContaining('Aborting 1'));
    await first;
  });

  it('resolves as interrupted (and aborts the build) when the interrupt wins', async () => {
    const queue = new RebuildQueue();
    let aborted = false;
    let interrupt!: (value: string) => void;
    const interruptPromise = new Promise<string>(r => (interrupt = r));

    const tracked = queue.track(abortable(() => (aborted = true)), interruptPromise);
    interrupt('stop');

    expect(await tracked).toEqual({ type: 'interrupted', value: 'stop' });
    expect(aborted).toBe(true);
  });

  it('dispose aborts active builds', async () => {
    const queue = new RebuildQueue();
    let aborted = false;
    const tracked = queue.track(abortable(() => (aborted = true)));

    queue.dispose();

    await tracked;
    expect(aborted).toBe(true);
  });
});
