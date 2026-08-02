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

/**
 * Sugar over the `sharedMappings` array form: `get()` returns entries that could equally
 * be written by hand. Without `filter()` the selection is every tsconfig path mapping.
 */
export function mappingsFromWorkspace(baseCfg: ExternalConfig = {}) {
  const selection: string[] = [];
  const patches: Array<{ patterns: string[]; cfg: Partial<ExternalConfig> }> = [];

  const builder = {
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
 * Looks a mapping's config up by its import name. Wildcard substitution rewrites imports
 * (`@org/ui/*` -> `@org/ui/button`), so the table is keyed by the pattern the user wrote and
 * matched, not compared. Declaration order decides: the first matching pattern wins.
 */
export function resolveMappingConfig(
  importName: string,
  configs: NormalizedSharedMappingConfigs
): NormalizedMappingConfig | undefined {
  for (const [pattern, config] of Object.entries(configs)) {
    if (matchesWildcard(importName, pattern)) return config;
  }

  return undefined;
}
