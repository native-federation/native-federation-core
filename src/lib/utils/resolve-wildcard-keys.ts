import fg from 'fast-glob';

export type KeyValuePair = {
  key: string;
  value: string;
};

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
  const normalizedPattern = valuePattern.replace(/^\.?\/+/, '');

  const asteriskIndex = normalizedPattern.indexOf('*');
  if (asteriskIndex === -1) {
    return [];
  }

  const prefix = normalizedPattern.substring(0, asteriskIndex);
  const suffix = normalizedPattern.substring(asteriskIndex + 1);

  // fast-glob requires **/* pattern for matching files at any depth
  const files = fg.sync(prefix + '**/*' + suffix, {
    cwd,
    onlyFiles: true,
    deep: Infinity,
  });

  const keys: KeyValuePair[] = [];

  for (const file of files) {
    const relPath = file.replace(/\\/g, '/').replace(/^\.\//, '');

    const captured = suffix
      ? relPath.slice(prefix.length, -suffix.length)
      : relPath.slice(prefix.length);

    const key = keyPattern.replace('*', captured);

    keys.push({
      key,
      value: relPath,
    });
  }

  return keys;
}
