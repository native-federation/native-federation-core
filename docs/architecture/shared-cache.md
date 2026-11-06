# Shared cache

[Docs](../README.md) › Architecture

## Rules

- Each shared bundle is cached on disk per project (the code calls this the externals cache), in a
  folder of its own, and copied into the output directory on a hit.
- The key covers everything that changes the bytes: the shared packages and their resolved
  versions, the core version, the relevant config and flags, and an identity the adapter declares
  (`externalsCacheKey`).
- A hit is also checked against the current plan, so a package that has since become external is
  not left inlined in a cached bundle. When in doubt, the cache misses.
- npm-linked packages are also keyed on their content.
- A hit runs no build, so data an adapter needs from that build is stored with the cache entry
  (`cacheData`).
- A shared run replaces the previous results only when every shared bundle has finished. A failed
  run keeps the last complete set, and the next build redoes every shared bundle.
- Deleting the cache folder is always safe.

## Why

- Bundling shared packages is the slowest part of a build, and its inputs rarely change. A cache
  that serves stale bytes is worse than none: the import map would serve code that does not match
  its version, or keep a package inlined after it has become shared.
- The adapter produces the bytes, so only the adapter knows which of its options change them.
- An edit to an npm-linked package does not change its version, so the version alone cannot
  invalidate it.

## Rejected

- Core reading bundler options itself: it breaks build-tool agnosticism.
- Adapters owning the cache: every adapter would duplicate the key and the persistence.

## Limits

- The cache is per project, so apps in one monorepo that share the same packages each keep and
  copy their own identical bundles.

Enforced by: `src/lib/core/build/bundle-shared.spec.ts`,
`src/lib/core/cache/federation-cache.spec.ts`,
`src/lib/core/build/rebuild-affected-externals.spec.ts`
Issues: core#103, core#113, core#152, core#154, core#179, core#190
Related: [Shared packages](shared-packages.md) (versions), [Build adapter](build-adapter.md),
[Output files](output-files.md), [File watcher](file-watcher.md)
