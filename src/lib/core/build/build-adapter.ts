import type { NFBuildAdapter } from '../../domain/core/build-adapter.contract.js';
import { logger } from '../../utils/logger.js';

let _buildAdapter: NFBuildAdapter | null = null;

export function setBuildAdapter(buildAdapter: NFBuildAdapter): void {
  _buildAdapter = buildAdapter;
}

// Warning frequency only: an adapter hears about each contract gap once per process.
export function warnOncePerAdapter(
  warned: WeakSet<object>,
  adapter: object | undefined,
  message: string
): void {
  if (!adapter || warned.has(adapter)) return;
  warned.add(adapter);
  logger.warn(message);
}

export function getBuildAdapter(): NFBuildAdapter {
  if (!_buildAdapter) {
    logger.error('Please set a BuildAdapter!');
    throw new Error('BuildAdapter not set');
  }
  return _buildAdapter;
}
