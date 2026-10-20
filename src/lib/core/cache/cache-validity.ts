import * as path from 'path';
import { initSync, parse } from 'es-module-lexer';
import type { FileReaderPort } from '../../domain/utils/io-port.contract.js';
import type { PackageJsonRepository } from '../../domain/utils/package-json.contract.js';
import { getPkgFolder } from '../../utils/io/package-json-repository.js';
import { isBare, matchesExternal } from '../../utils/bare-specifier.js';
import { logger } from '../../utils/logger.js';
import type { CacheMetadata } from './cache-persistence.js';

const DEPENDENCY_FIELDS = ['dependencies', 'peerDependencies', 'optionalDependencies'];

// Only what `external` kept bare: built-ins the bundler leaves alone on its own are not ours to check.
export function externalImportsCore(
  io: FileReaderPort,
  dir: string,
  files: string[],
  external: readonly string[]
): string[] {
  const found = new Set<string>();
  initSync();
  for (const file of files.filter(f => /\.(m|c)?js$/.test(f))) {
    let imports: ReturnType<typeof parse>[0];
    try {
      [imports] = parse(io.readText(path.join(dir, file)), file);
    } catch (e) {
      logger.debug(`Could not scan the imports of '${file}': ${(e as Error).message}`);
      continue;
    }
    for (const imp of imports) {
      const specifier = imp.n;
      if (imp.d === -2 || specifier === undefined || !isBare(specifier)) continue;
      if (matchesExternal(specifier, external)) found.add(specifier);
    }
  }
  return [...found].sort();
}

// Every package the entries can reach through package.json, resolved the way Node would.
export function dependencyClosureCore(
  roots: string[],
  folder: string,
  repo: PackageJsonRepository
): Set<string> {
  const names = new Set<string>();
  const visited = new Set<string>();
  const queue = roots.map(name => ({ name: getPkgFolder(name), from: folder }));

  while (queue.length > 0) {
    const { name, from } = queue.pop()!;
    names.add(name);
    const pkgJsonPath = repo.findDepPackageJson(name, from);
    if (!pkgJsonPath || visited.has(pkgJsonPath)) continue;
    visited.add(pkgJsonPath);

    const pkgJson = repo.readJson(pkgJsonPath);
    for (const field of DEPENDENCY_FIELDS) {
      for (const dep of Object.keys(pkgJson?.[field] ?? {})) {
        queue.push({ name: dep, from: path.dirname(pkgJsonPath) });
      }
    }
  }
  return names;
}

// Core cannot see what the bundler inlined, so a new external the entries can reach is a miss.
export function staleCacheReason(
  metadata: CacheMetadata,
  external: readonly string[],
  reachable: () => Set<string>
): string | undefined {
  if (!metadata.builtExternals || !metadata.externalImports) {
    return 'it does not record what it left external';
  }

  const dropped = metadata.externalImports.find(s => !matchesExternal(s, external));
  if (dropped) return `it imports '${dropped}', which is no longer external`;

  const built = new Set(metadata.builtExternals);
  const added = external.filter(e => !built.has(e));
  if (added.length === 0) return undefined;

  const packages = reachable();
  const inlined = added.find(e => packages.has(getPkgFolder(e)));
  return inlined ? `'${inlined}' is now external and may be inlined in it` : undefined;
}
