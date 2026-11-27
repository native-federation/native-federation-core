import type { NormalizedExternalConfig } from '../domain/config/external-config.contract.js';
import { toPosix } from './path-patterns.js';

export function normalize(path: string, trailingSlash?: boolean): string {
  let cand = toPosix(path);

  if (typeof trailingSlash === 'undefined') {
    return cand;
  }

  while (cand.endsWith('/')) {
    cand = cand.substring(0, cand.length - 1);
  }

  if (trailingSlash) {
    return cand + '/';
  }

  return cand;
}

export function normalizePackageName(fileName: string) {
  const sanitized = fileName.replace(/[^A-Za-z0-9]/g, '_');
  return sanitized.startsWith('_') ? sanitized.slice(1) : sanitized;
}

export function inferPackageFromSecondary(secondary: string): string {
  const parts = secondary.split('/');
  if (secondary.startsWith('@') && parts.length >= 2) {
    return parts[0] + '/' + parts[1];
  }
  return parts[0]!;
}

// A pool's name joins its segments with '-', which normalizePackageName never emits, so it cannot
// collide with a package's, and a share scope adds a segment.
export function sharedBundleOf(
  key: string,
  cfg: Pick<NormalizedExternalConfig, 'platform' | 'build' | 'pool' | 'shareScope'>
): { bundleName: string; ownPackage?: string } {
  if (cfg.build === 'default') return { bundleName: `${cfg.platform}-shared` };
  if (cfg.build === 'pool') {
    const segments = cfg.shareScope === undefined ? [cfg.pool] : [cfg.shareScope, cfg.pool];
    const names = segments.map(s => normalizePackageName(s ?? ''));
    return { bundleName: [cfg.platform, 'pool', ...names].join('-') };
  }
  const ownPackage = cfg.build === 'separate' ? key : inferPackageFromSecondary(key);
  return { bundleName: `${cfg.platform}-${normalizePackageName(ownPackage)}`, ownPackage };
}
