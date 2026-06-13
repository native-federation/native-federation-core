import { nodeIo } from '../io/node-io-adapter.js';
import type { GlobPort } from '../../domain/utils/io-port.contract.js';
import type { KeyValuePair } from '../../domain/utils/keyvaluepair.contract.js';
import { captureWildcard, parseWildcard, substituteWildcard, toPosix } from '../path-patterns.js';

/**
 * Resolves package.json exports wildcard patterns.
 *
 * In package.json exports, patterns like `./features/*.js` → `./src/features/*.js` work as follows:
 * - The `*` is a literal string replacement that can include path separators
 * - Importing `pkg/features/a/b.js` captures `a/b` and replaces `*` → `./src/features/a/b.js`
 * - This matches actual files, not directories
 *
 * @see https://nodejs.org/api/packages.html#subpath-patterns
 */
export function resolvePackageJsonExportsWildcard(
  keyPattern: string,
  valuePattern: string,
  cwd: string
): KeyValuePair[] {
  return resolvePackageJsonExportsWildcardCore(nodeIo, keyPattern, valuePattern, cwd);
}

export function resolvePackageJsonExportsWildcardCore(
  io: GlobPort,
  keyPattern: string,
  valuePattern: string,
  cwd: string
): KeyValuePair[] {
  const pattern = parseWildcard(valuePattern.replace(/^\.?\/+/, ''));
  if (!pattern.hasWildcard) {
    return [];
  }

  // fast-glob requires **/* pattern for matching files at any depth
  const files = io.globFiles(pattern.prefix + '**/*' + pattern.suffix, { cwd });

  const keys: KeyValuePair[] = [];

  for (const file of files) {
    const relPath = toPosix(file).replace(/^\.\//, '');

    const captured = captureWildcard(relPath, pattern);
    if (captured === null) continue;

    keys.push({
      key: substituteWildcard(keyPattern, captured),
      value: relPath,
    });
  }

  return keys;
}
