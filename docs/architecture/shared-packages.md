# Shared packages

[Docs](../README.md) › Architecture

## Rules

- A shared package is published as one unit, not entry point by entry point.
- It has one version for all its entry points: the installed one, unless the config pins a
  version. The declared range is a last resort, with a warning. A vendored copy of an installed
  package pins its version, or it is published as the installed one.
- `fromPackageJson()` without a base config shares every dependency with `singleton: true`,
  `strictVersion: true`, `requiredVersion: 'auto'` and `build: 'package'`. A passed base replaces
  that default instead of merging into it. A config without `shared` keeps its own default, without
  `build: 'package'`.
- An inferred `requiredVersion` keeps a declared semver range (`{ range }` still applies to it). A
  declared value that is not (`catalog:`, `workspace:`, `npm:`, `file:`, a dist-tag) publishes `~`
  on the installed version, floored (`17.3.5` → `~17.3.0`; a prerelease keeps its tag,
  `~18.0.0-rc.1`), or `{ range }` applied to it. With nothing installed, or no valid `version` in
  its `package.json`, the declared value is kept.
- Secondary entry points core expands from a shared package inherit its settings.
- With `ignoreUnusedDeps` (the default), only the entry points the build reaches are published.
  A shared package nothing reaches is dropped; `keepAll` keeps every entry point of one that is
  still reached.
- `preload: true` on a shared package is published on its record as `preload`. Like any config
  field, it is part of the shared bundle's config state, so toggling it renames the bundle's entry
  files on a rebuild; it changes nothing else in the build. It asks the runtime to fetch the
  package, with every chunk of the bundle it is built in (see [Chunks](chunks.md)), once the import
  map is in place, before anything imports it. Once one entry point of a package sets it, every
  entry point of that package does.

## Why

- The runtime serves a shared singleton package as a whole, at one version. A remote that
  publishes the entry points of one package at different versions, or with different settings,
  runs its own copy of the whole package next to the shared one, with no error.
- A record's version names the bytes in its file.
- Publishing every entry point of every dependency makes `remoteEntry.json` and the shared
  bundles far larger than what the app uses.
- Fetching a package before it is used is speculative, so it is opt-in per package: the remote
  knows a package is heavy and always needed by what it exposes.

## Rejected

- Merging a passed base into the `fromPackageJson()` default: every existing config that leaves out
  `strictVersion` or `build` would silently switch to strict versions and per-package bundles, and
  `build` has no value that turns it back off.
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
