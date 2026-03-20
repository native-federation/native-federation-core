import { logger } from './logger.js';
import { normalizePackageName } from './normalize.js';

export function resolveProjectName(config: { name?: string }): string {
  if (!config.name || config.name.length < 1) {
    logger.warn(
      "Project name in 'federation.config.js' is empty, defaulting to 'shell' cache folder (could collide with other projects in the workspace)."
    );
    return 'shell';
  }

  return normalizePackageName(config.name);
}
