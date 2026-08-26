import * as path from 'path';
import type { PathToImport } from '../domain/utils/mapped-path.contract.js';
import { parseWildcard, substituteWildcard, toPosix } from '../utils/path-patterns.js';

const MODULE_EXTENSION_PATTERN = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

/** Declaration files describe a module, they are not one. */
const DECLARATION_PATTERN = /\.d\.(ts|mts|cts)$/;

export function isModuleFile(filePath: string): boolean {
  return MODULE_EXTENSION_PATTERN.test(filePath) && !DECLARATION_PATTERN.test(filePath);
}

export function isSharedMapping(filePath: string, sharedMappings: PathToImport): boolean {
  for (const sharedPath of Object.keys(sharedMappings)) {
    const { prefix, hasWildcard } = parseWildcard(sharedPath);
    if (hasWildcard) {
      if (filePath.startsWith(prefix)) return true;
    } else if (filePath.startsWith(sharedPath + path.sep) || filePath === sharedPath) {
      return true;
    }
  }
  return false;
}

/**
 * The single rule that turns a file into the import specifier it is shared under. Both the
 * reachability walk and the `resolveGlob` expansion go through here, so an entry point cannot
 * end up advertised under a name the other side would not have produced.
 */
export function matchMapping(filePath: string, sharedMappings: PathToImport): string | null {
  for (const [sharedPath, sharedImport] of Object.entries(sharedMappings)) {
    const { prefix, suffix, hasWildcard } = parseWildcard(sharedPath);
    if (hasWildcard) {
      if (!filePath.startsWith(prefix)) continue;
      if (suffix && !filePath.includes(suffix)) continue;
      // First-occurrence capture: the path may contain the suffix more than once.
      const captured = suffix
        ? filePath.slice(prefix.length, filePath.indexOf(suffix, prefix.length))
        : filePath.slice(prefix.length);
      return substituteWildcard(sharedImport, toImportPath(captured));
    } else if (filePath === sharedPath || isIndexOf(filePath, sharedPath)) {
      return sharedImport;
    }
  }
  return null;
}

/**
 * Detect if it's a barrel file which is inferred by typescript
 */
const INDEX_PATTERN = /\/index\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

function isIndexOf(filePath: string, dirPath: string): boolean {
  return filePath.startsWith(dirPath + path.sep) && INDEX_PATTERN.test(filePath);
}

function toImportPath(filePath: string): string {
  const withoutExt = filePath.replace(MODULE_EXTENSION_PATTERN, '');
  const normalized = toPosix(withoutExt);
  return normalized.endsWith('/index') ? normalized.slice(0, -6) : normalized;
}
