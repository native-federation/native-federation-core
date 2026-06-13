import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger, setLogLevel } from './logger.js';

describe('logger', () => {
  afterEach(() => {
    setLogLevel('info');
    vi.restoreAllMocks();
  });

  it('always routes warn/error/info/notice to the right console method', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    logger.warn('w');
    logger.error('e');
    logger.info('i');
    logger.notice('n');

    expect(warn).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledTimes(2);
  });

  it('suppresses debug/verbose until log level is verbose', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    logger.debug('hidden');
    logger.verbose('hidden');
    expect(log).not.toHaveBeenCalled();

    setLogLevel('verbose');
    logger.debug('shown');
    logger.verbose('shown');
    expect(log).toHaveBeenCalledTimes(2);
  });

  it('exposes verbose as an alias of debug', () => {
    expect(logger.verbose).toBe(logger.debug);
  });

  it('measure only logs when verbose', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    logger.measure(process.hrtime(), 'milestone');
    expect(log).not.toHaveBeenCalled();

    setLogLevel('verbose');
    logger.measure(process.hrtime(), 'milestone');
    expect(log).toHaveBeenCalledOnce();
  });
});
