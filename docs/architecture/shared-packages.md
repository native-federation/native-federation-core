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
- An override configures the package it names; it never removes another package whose name starts
  with it.
- An entry point's subpath matches a package's `exports` keys as Node matches them: an exact key
  wins; otherwise the pattern with the longest text before its `*` wins, a tie going to the longer
  key. A pattern may have text after its `*`, which the subpath must end with, and the part it
  matches is never empty. Every `*` in the target is replaced by that part. A string, an array or
  a conditions object without `.` keys is the package root's entry.
- A valid target is a `./` path with no `.`, `..` or `node_modules` segment. A `null` target or an
  invalid one, at the subpath or under the condition that wins, means the entry point is not
  exported: core does not fall back to `module`, `main` or a conventional file, and the "No meta
  data found" warning says the package's exports block it. An array target resolves to its first
  valid target; with none, it is not exported either.
- The condition is picked as an ESM key, else `default`, else the first key that is not `types`.
  A browser entry never takes a `node` key, nor a node entry a `browser` key. A shared entry uses
  its own `platform`, in its bundle and in the unused-dependency scan; the scan reads a package
  that is not shared, such as a transitive dependency, through the browser key.
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
- The bundler resolves a package's `exports` the way Node does. Matching keys or picking targets
  any other way points an entry point at a different file than the one the bundler would pick, or
  at a file the package does not export.
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
- The `exports` conditions follow from `platform` alone; an adapter cannot add its own.
- A subpath the `exports` map does not list still falls back to `module`, `main` or a conventional
  file, while Node blocks it as it blocks a `null` target.

Enforced by: `src/lib/core/build/bundle-shared.spec.ts`,
`src/lib/config/remove-unused-deps.spec.ts`, `src/lib/config/share-utils.spec.ts`,
`src/lib/utils/package/exports-resolver.spec.ts`,
`src/lib/utils/package/entry-point-resolver.spec.ts`, `src/lib/utils/package/package-info.spec.ts`,
`src/lib/config/get-used-dependencies.spec.ts`
Issues: core#104, core#120, core#169, core#233, core#234
Related: [Shared mappings](shared-mappings.md), [Shared cache](shared-cache.md),
[Mapping packages](mapping-packages.md)
