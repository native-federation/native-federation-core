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

## DONE this session — `IoPort` through `config` + barrel cleanup (working tree only, NOT committed)

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

## DONE — `package-resolution` repository seam through `share*` (working tree, NOT committed)

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

## Caveat / known gap

The bundler orchestrators — `bundleShared`, `bundleExposedAndMappings`,
`normalizeFederationOptions` — now route IO through the adapter but are still NOT
unit-testable end-to-end: they depend on `getBuildAdapter()` and dynamic `import()`.
Only their extractable pure pieces are tested. Fully testing them needs a
`BuildAdapter` / `ConfigLoader` seam — a larger follow-up.

## Next / deferred (decided with user)

1. **`core` subfolder reorg — DEFERRED.** Do as a separate move-only commit so it
   doesn't tangle with content diffs. Proposed grouping if/when done:
   `core/build/` (build/rebuild/bundle/result-map/rewrite/adapter/externals),
   `core/cache/` (cache-persistence, federation-cache), `core/output/` (write-*),
   with `normalize-options`/`rebuild-queue`/`federation-builder` at root.
   ⚠ Do NOT create `core/package-resolution` — that layer already exists at
   `src/lib/package-resolution`; a copy in core would be confusing.

2. **`package-resolution` IoPort/repository seam — DONE** (see section above).
   Remaining: the boundary ESLint rule could be extended to `package-resolution`
   (already fs-free) and `utils` outside the adapter.

3. **`BuildAdapter` / `ConfigLoader` seam** — to unblock end-to-end testing of the
   bundler orchestrators (`bundleShared`, `bundleExposedAndMappings`,
   `normalizeFederationOptions`).

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
- Check core/config stay clean:
  `grep -rn "from 'fs'\|from 'crypto'" src/lib/core/*.ts src/lib/config/*.ts | grep -v spec`
