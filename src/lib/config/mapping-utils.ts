import type { ExternalConfig } from '../domain/config/external-config.contract.js';
import type {
  NormalizedMappingConfig,
  NormalizedSharedMappingConfigs,
  SharedMappingEntry,
} from '../domain/config/federation-config.contract.js';
import type { PreparedSkipList } from '../domain/config/skip-list.contract.js';
import type { PathToImport } from '../domain/utils/mapped-path.contract.js';
import { isInSkipList } from './default-skip-list.js';
import { matchesWildcard } from '../utils/path-patterns.js';
import { logger } from '../utils/logger.js';

const ALL = '*';

export interface WorkspaceMappingsBuilder {
  filter(patterns: string[]): WorkspaceMappingsBuilder;
  patch(patterns: string[], cfg: Partial<ExternalConfig>): WorkspaceMappingsBuilder;
  get(): SharedMappingEntry[];
}

/**
 * Sugar over the `sharedMappings` array form: `get()` returns entries that could equally
 * be written by hand. Without `filter()` the selection is every tsconfig path mapping.
 */
export function mappingsFromWorkspace(baseCfg: ExternalConfig = {}): WorkspaceMappingsBuilder {
  const selection: string[] = [];
  const patches: Array<{ patterns: string[]; cfg: Partial<ExternalConfig> }> = [];

  const builder: WorkspaceMappingsBuilder = {
    filter(patterns: string[]) {
      selection.push(...patterns);
      return builder;
    },
    patch(patterns: string[], cfg: Partial<ExternalConfig>) {
      patches.push({ patterns, cfg });
      return builder;
    },
    get(): SharedMappingEntry[] {
      const selected = selection.length > 0 ? [...selection] : [ALL];
      const entries: SharedMappingEntry[] = [];

      for (const { patterns, cfg } of patches) {
        const kept = patterns.filter(p => isSelected(p, selected));

        for (const dropped of patterns.filter(p => !isSelected(p, selected))) {
          logger.warn(
            `[mappingsFromWorkspace] patch('${dropped}') is not covered by filter() and was ignored.`
          );
        }

        if (kept.length > 0) entries.push([kept, { ...baseCfg, ...cfg }]);
      }

      // Patches precede the selection so first-match-wins resolves them first.
      entries.push([selected, baseCfg]);

      return entries;
    },
  };

  return builder;
}

function isSelected(pattern: string, selection: string[]): boolean {
  return selection.some(s => matchesWildcard(pattern, s));
}

/**
 * Wildcard mappings are only turned into concrete imports after the skip list has already been
 * applied to the raw patterns, so the expanded entries have to be filtered again here.
 */
export function withoutSkippedMappings(
  paths: PathToImport,
  skipList: PreparedSkipList
): PathToImport {
  return Object.entries(paths)
    .filter(([, mappedImport]) => !isInSkipList(mappedImport, skipList))
    .reduce((acc, [mappedPath, mappedImport]) => {
      acc[mappedPath] = mappedImport;
      return acc;
    }, {} as PathToImport);
}

/**
 * Sole owner of the mapping defaults. `includeSecondaries` collapses to a boolean the same way
 * `normalizeShared` does it, so both halves of `removeUnusedDeps` read one flag; `resolveGlob`
 * is lifted out because it steers wildcard expansion, not secondary entry points.
 */
export function normalizeMappingConfig(
  cfg: ExternalConfig,
  mappingVersion: boolean
): NormalizedMappingConfig {
  const includeSecondaries =
    typeof cfg.includeSecondaries === 'object'
      ? !!cfg.includeSecondaries.keepAll
      : cfg.includeSecondaries;

  return {
    singleton: cfg.singleton ?? true,
    strictVersion: cfg.strictVersion ?? mappingVersion,
    ...(cfg.requiredVersion !== undefined && { requiredVersion: cfg.requiredVersion }),
    ...(cfg.version !== undefined && { version: cfg.version }),
    ...(cfg.shareScope && { shareScope: cfg.shareScope }),
    ...(cfg.pool && { pool: cfg.pool }),
    ...(includeSecondaries !== undefined && { includeSecondaries }),
    ...(typeof cfg.includeSecondaries === 'object' &&
      cfg.includeSecondaries.resolveGlob && { resolveGlob: true }),
  };
}

/**
 * Looks a mapping's config up by its import name. Wildcard substitution rewrites imports
 * (`@org/ui/*` -> `@org/ui/button`), so the table is keyed by the pattern the user wrote and
 * matched, not compared. Declaration order decides: the first matching pattern wins.
 * Falls back to the defaults so callers never re-state them.
 */
export function resolveMappingConfig(
  importName: string,
  configs: NormalizedSharedMappingConfigs,
  mappingVersion: boolean
): NormalizedMappingConfig {
  for (const [pattern, config] of Object.entries(configs)) {
    if (matchesWildcard(importName, pattern)) return config;
  }

  return normalizeMappingConfig({}, mappingVersion);
}
