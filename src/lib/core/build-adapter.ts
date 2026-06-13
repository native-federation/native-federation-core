import type { NFBuildAdapter } from '../domain/core/build-adapter.contract.js';
import { logger } from '../utils/logger.js';

let _buildAdapter: NFBuildAdapter | null = null;

export function setBuildAdapter(buildAdapter: NFBuildAdapter): void {
  _buildAdapter = buildAdapter;
}

export function getBuildAdapter(): NFBuildAdapter {
  if (!_buildAdapter) {
    logger.error('Please set a BuildAdapter!');
    throw new Error('BuildAdapter not set');
  }
  return _buildAdapter;
}
