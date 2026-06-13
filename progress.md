# Progress — `IoPort` refactor & architecture work

Branch: `issues/55` (base: `main`). Last updated: 2026-06-13.

## Context: the architecture being refactored

The lib was split from a flat `utils/` grab-bag into layers with a clean,
acyclic dependency direction (verified — no cycles):

```
domain (pure contracts/types, .contract.ts, zero runtime deps)
   ↑
utils (IoPort + nodeIo adapter, logger, hashing, watching, path-patterns)
   ↑
package-resolution (package.json walking, exports resolution)
   ↑
config (with-native-federation, share, skip-list)
   ↑
core (build/rebuild orchestration, bundling, cache, federation builder)
```

**The pattern:** filesystem/crypto/glob access goes through `IoPort`
(`src/lib/domain/utils/io-port.contract.ts`), implemented by `nodeIo`
(`src/lib/utils/io/node-io-adapter.ts`) and faked in tests by `createMemoryIo()`
(`src/lib/utils/io/__test-helpers__/memory-io.ts`). Convention:

- public fn `foo(...)` → thin wrapper calling `fooCore(nodeIo, ...)`
- `fooCore(io: <PortSlice>, ...)` holds the logic, takes only the port slice it needs
- spec tests target `fooCore` with `createMemoryIo()`

Reference templates: `core/cache-persistence.ts`, `utils/hash-file.ts`.

## DONE — `IoPort` through `core` (committed)

`src/lib/core` no longer imports `fs`/`crypto`/`fast-glob` directly, enforced by a
scoped `no-restricted-imports` ESLint rule. Committed in `ecc6f0f` (core) and
`79cf501` (utils). See those commits for the per-file detail; the new
`compute-integrity.ts` DRYs the SRI loop, and `getMappingVersion` switched from an
`err.code === 'ENOENT'` check to `io.isFile()`.

## DONE — `IoPort` through `config` + barrel cleanup (committed `71c224a`)

`config/share-utils.ts` was the last non-spec file importing `fs` directly. Now
converted. Files changed:

- **`io-port.contract.ts`** — added `readDir(path): string[]` to `FileReaderPort`
  (returns immediate child names; empty array on ENOENT, never throws).
- **`node-io-adapter.ts`** / **`memory-io.ts`** — implement `readDir`.
- **`config/share-utils.ts`** — `findRootTsConfigJson`, `share`, `shareAll` got
  `nodeIo` wrappers + `*Core(io, ...)`; `io` threaded through the private helpers
  (`findPackageJson`, `_findSecondaries`, `findSecondaries`, `getSecondaries`,
  `readConfiguredSecondaries`). `getSecondaries` is exported as the testable seam.
- **`eslint.config.mts`** — the core boundary rule now also covers
  `src/lib/config/**` (specs excluded). Verified with a live probe that it fires.
- **`src/internal.ts`** — removed the duplicate `AbortedError` export and the
  duplicate `createBuildResultMap`/`lookupInResultMap`/`popFromResultMap` block
  (both already re-exported via `export *`).

**Tests added:** `config/share-utils.spec.ts` (7 cases) — `findRootTsConfigJsonCore`
(base/fallback/throw) + `getSecondaries` (missing path, exports-driven discovery,
`readDir` folder-walk, skip-list exclusion).

**Verification (all green):** `npm test -- --run` → 161 passed · `npm run typecheck`
· `npm run lint` (0 errors; 8 pre-existing warnings) · `grep` gate confirms `config`
is fs/crypto-free.

## DONE — `package-resolution` repository seam through `share*` (committed `71c224a`)

`shareCore`/`shareAllCore` are now end-to-end testable. They previously threaded
`io` for directory-walking but their three `package-resolution` calls
(`getVersionMaps` ×2, `findDepPackageJson`) silently fell back to the process-wide
real-fs `defaultRepo`. Now a `PackageJsonRepository` is threaded through:

- **`package-info.ts`** — `defaultRepo` is now exported.
- **`config/share-utils.ts`** — `shareCore`, `shareAllCore`, and private
  `lookupVersion` take `repo: PackageJsonRepository = defaultRepo`; the three calls
  use it. Public `share()`/`shareAll()` are unchanged → production keeps the
  process-wide cross-call package.json cache (decided with user: thread-with-default
  over derive-from-io, to preserve caching).
- **`config/share-utils.spec.ts`** — 4 end-to-end cases driven by `createMemoryIo()`
  + `createPackageJsonRepository(io)`: `shareCore` auto-version resolution, secondary
  discovery through the repo, missing-dep fallback; `shareAllCore` dep-map → externals
  with skip-list + overrides.

**Verification (all green):** `npm test -- --run` → 165 passed · `npm run typecheck`
· `npm run lint` (0 errors; 8 pre-existing warnings).

## DONE — `BuildAdapter` / `ConfigLoader` seam through the bundler orchestrators (committed `bde931f`)

`normalizeFederationOptions`, `bundleExposedAndMappings`, and `bundleShared` are now
end-to-end testable. Each public fn is an unchanged thin wrapper delegating to a new
`*Core(deps, ...)` that takes its dependencies injected:

- **`normalize-options.ts`** — new `ConfigLoader` type + `defaultConfigLoader`
  (the dynamic `import()`); `normalizeFederationOptionsCore({ io, loadConfig }, ...)`.
  Tests pass a fake loader + memory `io` + a supplied `cache` (skips
  `createFederationCache`/`getDefaultCachePath`). The `ignoreUnusedDeps` branch is
  NOT covered (its `getUsedDependenciesFactory` still uses `defaultRepo` — see gap).
- **`bundle-exposed-and-mappings.ts`** — `bundleExposedAndMappingsCore({ adapter }, ...)`.
- **`bundle-shared.ts`** — `bundleSharedCore({ io, repo, adapter }, ...)`; threaded
  `getChecksumCore`/`cacheEntryCore`/`computeIntegrityMapCore`/`rewriteChunkImportsCore`
  and `getPackageInfo(..., repo)` so the whole path is driven by the injected `io`/`repo`.
- **`core/__test-helpers__/fake-build-adapter.ts`** — `createFakeBuildAdapter({ io?, results? })`;
  records setup/build/dispose, echoes one result per setup entry point (writing files
  through `io` when given), mirroring `memory-io`.

**Public API unchanged (verified):** the four entry barrels' `.d.ts`
(`index`/`config`/`domain`/`internal`) are byte-identical before/after; only the
internal modules gained additive `*Core` exports (not re-exported anywhere public).

**Verification (all green):** `npm test -- --run` → 174 passed · `npm run typecheck`
· `npm run lint` (0 errors; 8 pre-existing warnings).

## DONE — `getUsedDependenciesFactory` seam → `ignoreUnusedDeps` branch testable (uncommitted)

The last fs-bound gap is closed. `getUsedDependenciesFactory` had three impure
collaborators — `getProjectData` (sheriff, reads disk via `cwd()`), `getPackageInfo`
(→ process-wide `defaultRepo`), and `getExternalImports` (→ `nodeIo`). All three are
now injected via a `*Core(deps, ...)` seam. Files changed:

- **`config/get-used-dependencies.ts`** — new `UsedDependenciesDeps { io, repo,
  getProjectData }` + `GetProjectData` type; `getUsedDependenciesFactoryCore(deps, ...)`
  holds the logic, public `getUsedDependenciesFactory` is a thin wrapper over
  `defaultDeps` (`{ nodeIo, defaultRepo, sheriffGetProjectData }`). `addTransientDeps`
  takes `deps` and uses `getPackageInfo(..., repo)` + `getExternalImportsCore(io, ...)`.
- **`core/normalize-options.ts`** — `NormalizeFederationDeps` gains optional
  `usedDependenciesFactory` (defaults to the real factory). The factory is now built
  lazily *inside* the `ignoreUnusedDeps` branch (not built when the feature is off).

**Tests added:** `get-used-dependencies.spec.ts` (5 cases for `…FactoryCore` driven by
`createMemoryIo()` + `createPackageJsonRepository(io)` + a canned `getProjectData`:
external/unresolved collection, transient peer discovery through repo+io, internal
mapping resolution, entry-point fallback, missing-entrypoint throw) and
`normalize-options.spec.ts` (1 case: `ignoreUnusedDeps: true` with an injected fake
factory prunes `shared` + sets `sharedMappings`, logs info).

**Public API unchanged:** only `normalizeFederationOptions` is re-exported (signature
untouched); the new `*Core`/deps symbols are internal.

**Verification (all green):** `npm test -- --run` → 180 passed · `npm run typecheck`
· `npm run lint` (0 errors; 8 pre-existing warnings).

## DONE — `core` subfolder reorg (uncommitted, move-only)

`src/lib/core` is split into three subfolders; `git mv` preserved history as renames.
Pure moves + import-path rewrites — no logic or public-API changes.

- **`core/build/`** — build-adapter, build-for-federation, rebuild-for-federation,
  bundle-exposed-and-mappings, bundle-shared, build-result-map, rewrite-chunk-imports,
  compute-integrity, default-external-list, get-externals, + `__test-helpers__/`.
- **`core/cache/`** — cache-persistence, federation-cache.
- **`core/output/`** — write-federation-info, write-import-map.
- **root** (unchanged location) — federation-builder, normalize-options, rebuild-queue.

Import rewrites: moved files' cross-layer `../…` → `../../…` (the test-helper, two
levels deep, → `../../../…`); cross-folder intra-core edges retargeted (e.g.
`build-for-federation` → `../output/…`, `../cache/…`; `federation-builder` →
`./build/…`; `normalize-options` → `./cache/…`). `src/index.ts` + `src/internal.ts`
barrels repointed — diffs are path-string-only, every exported symbol/type unchanged.
⚠ No `core/package-resolution` — that layer already lives at `src/lib/package-resolution`.

**Verification (all green):** `npm run typecheck` · `npm test -- --run` → 180 passed
· `npm run lint` (0 errors; 8 pre-existing warnings) · recursive grep gate confirms
`core` stays fs/crypto/glob-free.

**Not committed** (per user). Note: `normalize-options.ts` carries both the reorg
path edits *and* the uncommitted `getUsedDependenciesFactory` content edits, so a
strictly "moves-only" commit isn't separable from this state.

## DONE — comment trim (uncommitted)

Aggressive pass over comments *added on this branch only*: removed
refactor/history-narration ("replaces the previous…"), dependency-injection plumbing
notes ("tests inject a fake"), and comments restating the code. Kept only comments
explaining genuinely non-obvious behavior or gotchas.

## Next / deferred (decided with user)

1. **`core` subfolder reorg — DONE** (see section above, uncommitted move-only).

2. **`package-resolution` IoPort/repository seam — DONE** (see section above).
   Remaining: the boundary ESLint rule could be extended to `package-resolution`
   (already fs-free) and `utils` outside the adapter.

3. **`BuildAdapter` / `ConfigLoader` seam — DONE** (see section above).

4. **`getUsedDependenciesFactory` seam — DONE** (see section above). The
   `ignoreUnusedDeps` branch of `normalizeFederationOptions` is now fs-free testable.

## Architecture review findings still open (lower priority)

- `domain/` is really a contracts/types folder, not a DDD domain (no behavior).
  Name sets a misleading expectation.
- `any` used for parsed package.json in `package-resolution` despite a
  `PartialPackageJson` type existing — inconsistent typing of the same shape.
- `nodeIo` and `MemoryIo` hand-duplicate the identical `Digest` hash closure.

## Useful commands

- Test once: `npm test -- --run`   (watch: `npm test`)
- Typecheck: `npm run typecheck`
- Lint: `npm run lint`
- Check core/config stay clean (recursive — core now has subfolders):
  `grep -rn "from 'fs'\|from 'crypto'" src/lib/core src/lib/config --include='*.ts' | grep -v spec`
