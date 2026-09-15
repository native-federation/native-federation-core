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

export interface MappingMatch {
  /** The mapping's own path, not the file that matched it. */
  mappedPath: string;
  importName: string;
}

export interface MatchMappingOptions {
  /**
   * Answers whether a mapped path is a built package directory. Supplied by callers that have
   * disk access; without it a package mapping only matches the directory itself, which is the
   * pre-package behaviour.
   */
  isPackage?: (mappedPath: string) => boolean;
}

/**
 * The single rule that turns a file into the import specifier it is shared under. Both the
 * reachability walk and the `resolveGlob` expansion go through here, so an entry point cannot
 * end up advertised under a name the other side would not have produced.
 */
export function matchMapping(
  filePath: string,
  sharedMappings: PathToImport,
  opts?: MatchMappingOptions
): string | null {
  return matchMappingEntry(filePath, sharedMappings, opts)?.importName ?? null;
}

/**
 * As {@link matchMapping}, but also reports which mapping matched. A package mapping is matched
 * by containment, so the file that matched (`types/ui.d.ts` from TypeScript, `fesm2022/ui.mjs`
 * from esbuild) is an artefact of who asked — only the package directory identifies the mapping,
 * and that is what a caller must key by.
 */
export function matchMappingEntry(
  filePath: string,
  sharedMappings: PathToImport,
  opts?: MatchMappingOptions
): MappingMatch | null {
  for (const [sharedPath, sharedImport] of Object.entries(sharedMappings)) {
    const { prefix, suffix, hasWildcard } = parseWildcard(sharedPath);
    if (hasWildcard) {
      if (!filePath.startsWith(prefix)) continue;
      if (suffix && !filePath.includes(suffix)) continue;
      // First-occurrence capture: the path may contain the suffix more than once.
      const captured = suffix
        ? filePath.slice(prefix.length, filePath.indexOf(suffix, prefix.length))
        : filePath.slice(prefix.length);
      return {
        mappedPath: filePath,
        importName: substituteWildcard(sharedImport, toImportPath(captured)),
      };
    } else if (filePath === sharedPath || isIndexOf(filePath, sharedPath)) {
      // The matched file, never the directory: a mapping onto `libs/ui/src` resolves through
      // `index.ts`, and that file is what the bundler needs as an entry point.
      return { mappedPath: filePath, importName: sharedImport };
    } else if (isUnder(filePath, sharedPath) && opts?.isPackage?.(sharedPath)) {
      // A package is the exception — its two resolvable files disagree, so only the directory
      // identifies it, and the entry point is read from its manifest instead.
      return { mappedPath: sharedPath, importName: sharedImport };
    }
  }
  return null;
}

/**
 * Detect if it's a barrel file which is inferred by typescript
 */
const INDEX_PATTERN = /\/index\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

function isIndexOf(filePath: string, dirPath: string): boolean {
  return isUnder(filePath, dirPath) && INDEX_PATTERN.test(filePath);
}

function isUnder(filePath: string, dirPath: string): boolean {
  return filePath.startsWith(dirPath + path.sep);
}

function toImportPath(filePath: string): string {
  const withoutExt = filePath.replace(MODULE_EXTENSION_PATTERN, '');
  const normalized = toPosix(withoutExt);
  return normalized.endsWith('/index') ? normalized.slice(0, -6) : normalized;
}
