import * as path from 'path';
import type { FileReaderPort } from '../../domain/utils/io-port.contract.js';
import type { PackageJsonRepository } from '../../domain/utils/package-json.contract.js';
import { getPkgFolder } from '../../utils/io/package-json-repository.js';
import { matchesExternal, readBareImports } from '../../utils/bare-specifier.js';
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
  for (const file of files.filter(f => /\.(m|c)?js$/.test(f))) {
    for (const specifier of readBareImports(io, path.join(dir, file), file)) {
      if (matchesExternal(specifier, external)) found.add(specifier);
    }
  }
  return [...found].sort();
}

// Every package the entries declare a dependency on, directly or transitively.
export function dependencyClosureCore(
  io: FileReaderPort,
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
    // From the real path: pnpm installs a package's own dependencies next to its store copy.
    const dir = path.dirname(io.realpath(pkgJsonPath));
    for (const field of DEPENDENCY_FIELDS) {
      for (const dep of Object.keys(pkgJson?.[field] ?? {})) queue.push({ name: dep, from: dir });
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

  let packages: Set<string>;
  try {
    packages = reachable();
  } catch (e) {
    return `its dependencies could not be read: ${(e as Error).message}`;
  }
  const inlined = added.find(e => packages.has(getPkgFolder(e)));
  return inlined ? `'${inlined}' is now external and may be inlined in it` : undefined;
}
