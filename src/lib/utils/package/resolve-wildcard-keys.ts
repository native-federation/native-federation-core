import type { GlobPort } from '../../domain/utils/io-port.contract.js';
import type { KeyValuePair } from '../../domain/utils/keyvaluepair.contract.js';
import { captureWildcard, parseWildcard, substituteWildcard, toPosix } from '../path-patterns.js';

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
