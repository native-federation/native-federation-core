# Shared packages

[Docs](../README.md) › Architecture

## Rules

- A shared package is published as one unit, not entry point by entry point.
- It has one version for all its entry points: the installed one, unless the config pins a
  version. The declared range is a last resort, with a warning. A vendored copy of an installed
  package pins its version, or it is published as the installed one.
- Secondary entry points core expands from a shared package inherit its settings.
- With `ignoreUnusedDeps` (the default), only the entry points the build reaches are published.
  A shared package nothing reaches is dropped; `keepAll` keeps every entry point of one that is
  still reached.

## Why

- The runtime serves a shared singleton package as a whole, at one version. A remote that
  publishes the entry points of one package at different versions, or with different settings,
  runs its own copy of the whole package next to the shared one, with no error.
- A record's version names the bytes in its file.
- Publishing every entry point of every dependency makes `remoteEntry.json` and the shared
  bundles far larger than what the app uses.

## Rejected

- Taking the version from the declared range in `package.json`: a range does not name the bytes,
  so an upgrade would keep serving old files under the old version.

## Limits

- Pruning depends on the import scan. An entry point it misses but the output still imports is
  caught by the bare-import check, not served silently (see
  [Published imports](published-imports.md)).

Enforced by: `src/lib/core/build/bundle-shared.spec.ts`,
`src/lib/config/remove-unused-deps.spec.ts`, `src/lib/config/share-utils.spec.ts`
Issues: core#104, core#120, core#169, core#233, core#234
Related: [Shared mappings](shared-mappings.md), [Shared cache](shared-cache.md),
[Mapping packages](mapping-packages.md)
