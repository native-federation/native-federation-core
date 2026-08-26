import * as path from 'path';
import type { NormalizedFederationConfig } from '../../domain/config/federation-config.contract.js';
import type { NormalizedFederationOptions } from '../../domain/core/federation-options.contract.js';
import type { FileReaderPort } from '../../domain/utils/io-port.contract.js';
import type { PackageJsonRepository } from '../../domain/utils/package-json.contract.js';
import { nodeIo } from '../../utils/io/node-io-adapter.js';
import { sharedPackageJsonRepository } from '../../utils/package/package-info.js';
import { isOutsideNodeModules, isUnderDir, toPosix } from '../../utils/path-patterns.js';

interface SharedEntry {
  key: string;
  /** realpath'd package directory (symlink resolved to its dev checkout). */
  realDir: string;
  isSymlink: boolean;
}

const folderOf = (fedOptions: NormalizedFederationOptions): string =>
  fedOptions.packageJson ? path.dirname(fedOptions.packageJson) : fedOptions.workspaceRoot;

function resolveEntries(
  keys: readonly string[],
  folder: string,
  io: FileReaderPort,
  repo: PackageJsonRepository
): SharedEntry[] {
  const out: SharedEntry[] = [];
  for (const key of keys) {
    const pkgJsonPath = repo.findDepPackageJson(key, folder);
    if (!pkgJsonPath) continue;
    const pkgDir = path.dirname(pkgJsonPath);
    const realDir = toPosix(io.realpath(pkgDir));
    out.push({
      key,
      realDir,
      // pnpm's default linker symlinks every dep, so the link alone proves nothing.
      isSymlink: !!io.stat(pkgDir)?.isSymbolicLink && isOutsideNodeModules(realDir),
    });
  }
  return out;
}

/** Each `config.shared` key → its realpath'd package dir, so watcher, checksum, and
 *  file-mapping agree on one identity for symlinked (npm-linked) deps. */
export function resolveSharedPackageDirs(
  config: NormalizedFederationConfig,
  fedOptions: NormalizedFederationOptions,
  io: FileReaderPort = nodeIo,
  repo: PackageJsonRepository = sharedPackageJsonRepository
): Map<string, string> {
  const entries = resolveEntries(Object.keys(config.shared), folderOf(fedOptions), io, repo);
  return new Map(entries.map(e => [e.key, e.realDir]));
}

/** Realpath'd dirs of symlinked shared packages — the bounded watch set.
 *  Deduped, since secondaries share a package dir. Empty unless `watchLinkedDeps` is on. */
export function linkedSharedDirs(
  config: NormalizedFederationConfig,
  fedOptions: NormalizedFederationOptions,
  io: FileReaderPort = nodeIo,
  repo: PackageJsonRepository = sharedPackageJsonRepository
): string[] {
  if (!fedOptions.watchLinkedDeps) return [];
  const entries = resolveEntries(Object.keys(config.shared), folderOf(fedOptions), io, repo);
  return [...new Set(entries.filter(e => e.isSymlink).map(e => e.realDir))];
}

/**
 * Source directories of the workspace libs in `config.sharedMappings` — the watch set
 * for mappings, derived from config alone rather than from a bundler cache.
 *
 * Coarser than the inputs a build actually compiled, and deliberately so: it covers
 * files added to a lib after the last build, which a compiled-inputs watch set cannot
 * know about yet. It does not follow imports out of the lib, so an adapter that can
 * enumerate its build inputs should watch both. See angular-adapter#94.
 *
 * How coarse is the caller's to bound: an entry point that is not a lib barrel widens the
 * watch to whatever directory it sits in (`'@app/env': ['src/environments/environment.ts']`
 * to that folder, `'@shared': ['src/index.ts']` to all of `src`), and with `sharedMappings`
 * unset every tsconfig path becomes a mapping. Watch these natively rather than polled —
 * they are source trees, not the dist output `linkedSharedDirs` exists for.
 */
export function sharedMappingDirs(config: NormalizedFederationConfig): string[] {
  const dirs = Object.keys(config.sharedMappings)
    .map(entryPoint => toPosix(path.dirname(entryPoint)))
    .filter(isOutsideNodeModules);
  return [...new Set(dirs)];
}

function maxMtime(io: FileReaderPort, dir: string): number {
  let max = 0;
  const walk = (d: string) => {
    for (const name of io.readDir(d)) {
      // io.isDirectory follows links, so an unguarded walk can wander out of the package.
      if (name === 'node_modules') continue;
      const full = path.join(d, name);
      if (io.isDirectory(full)) walk(full);
      else {
        let s = io.stat(full);
        // stat is lstat-based: a symlinked file reports the link's own mtime, not the
        // target's. Follow it so an edit to the real file still moves the signal.
        if (s?.isSymbolicLink) s = io.stat(io.realpath(full));
        if (s && s.mtimeMs > max) max = s.mtimeMs;
      }
    }
  };
  walk(dir);
  return max;
}

/** Per-key content signal (max mtime of the resolved dir) for symlinked deps only.
 *  Registry deps get no signal, keeping their checksum version-only. (Every key is
 *  still resolved: detecting the symlink requires the realpath + lstat.) */
export function linkedContentSignals(
  keys: string[],
  folder: string,
  io: FileReaderPort = nodeIo,
  repo: PackageJsonRepository = sharedPackageJsonRepository
): Record<string, string> {
  const signals: Record<string, string> = {};
  // Secondaries resolve to one dir and each walk is a full recursive stat, so do it once.
  const byDir = new Map<string, string>();
  for (const entry of resolveEntries(keys, folder, io, repo)) {
    if (!entry.isSymlink) continue;
    let signal = byDir.get(entry.realDir);
    if (signal === undefined) {
      signal = String(maxMtime(io, entry.realDir));
      byDir.set(entry.realDir, signal);
    }
    signals[entry.key] = signal;
  }
  return signals;
}

/** `config.shared` keys whose package directory contains at least one modified file. */
export function affectedSharedKeys(
  modifiedFiles: readonly string[],
  dirs: Map<string, string>,
  io: FileReaderPort = nodeIo
): Set<string> {
  const affected = new Set<string>();
  if (modifiedFiles.length === 0 || dirs.size === 0) return affected;

  const realFiles = modifiedFiles.map(f => toPosix(io.realpath(f)));

  for (const [key, dir] of dirs) {
    if (realFiles.some(f => isUnderDir(f, dir))) affected.add(key);
  }
  return affected;
}
