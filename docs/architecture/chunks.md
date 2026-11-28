# Chunks

[Docs](../README.md) › Architecture

## Rules

- Chunks are published as unshared and scoped to the remote that emitted them. A chunk name is
  only meaningful within its own build, not a share key.
- Chunks are named by a hash of the bytes they serve, so identical bytes keep one name across
  rebuilds and changed bytes always get a new one.
- Shared packages, mappings and exposed modules are bundled apart.
- Code splitting (`chunks`) is set per bundle; `build` gives a package, or a pool, a bundle of its
  own. Like the rest of a package's config, `chunks` comes from the package, never from one of its
  entry points (see [Shared packages](shared-packages.md)), so only the packages of one pool, or
  the mappings in one mapping bundle, can disagree.
- A chunk is never a `shared` record. Each exposed module and each shared or mapping record lists
  in `chunks` every chunk it reaches, `initial` marking its static closure. Nothing else in
  `remoteEntry.json` names a chunk: there is no list per bundle and no bundle name on a record.
- Core rewrites an import of a chunk to its `@nf-internal` name in every script of a shared bundle,
  and in the entries of mapping and exposed bundles, a bundle that does not split included. A
  chunk-to-chunk import in a mapping or exposed bundle stays relative (`./chunk-x.js`).
- `build: 'pool'` builds the shared packages of one platform, share scope and `pool` label in one
  bundle, `<platform>-pool-<label>`. Like the combined bundle it keeps every shared specifier bare,
  its members' own subpaths included, so a subpath a member does not publish stays unresolved.
  `pool` alone builds nothing together.
- Which packages share a chunk within one build is not promised; a shared chunk never creates
  more instances than inlining would. Coupling is done with `pool` (see Mapping packages).
- An owner's map holds every file of its own build it reaches, directly or through each other:
  relative imports and this build's own `@nf-internal` chunks, static or a literal `import()`.
  Any other bare specifier ends the walk. The walk starts at an exposed module's file, or at every
  entry of a shared or mapping record, so a record's `initial` is the union over its entries. A
  row is keyed by the file's import name (`@nf-internal/<name>`) and holds `{ file, initial? }`;
  `initial: true` marks the files reached by static imports alone and is never written as
  `false`. An owner that reaches none has no `chunks`. The maps are computed from the output files
  on every build and rebuild, before the published imports are checked against them.
- A chunk several owners reach is listed by each of them, with that owner's own `initial`. Maps
  are never deduplicated across owners.
- The bundle an entry point is built in never splits a shared package's record: the record's map
  covers the chunks of every bundle its entries are built in. A declared mapping package is built
  in one bundle and publishes one record (see [Mapping packages](mapping-packages.md)).
- A shared package that sets `preload` preloads the `initial` chunks of its own record.

## Why

- A chunk is code the bundler split out of one or more entry points. It has no package name,
  version or config of its own, so nothing downstream can tell whether the code it was split from
  asked to be a singleton, used a share scope, or was meant to stay private. A chunk the runtime
  shared by name could serve another build's bytes, or share state that was never meant to be
  shared.
- A chunk factored out of both a mapping and an exposed module would split one remote against
  itself, because the import map may serve that mapping from another remote.
- The runtime preloads a module's chunks next to the module itself. `modulepreload` does not
  fetch a module's dependencies, and an exposed module's relative chunk imports appear nowhere
  else in `remoteEntry.json`. A bare specifier resolves through the import map, possibly to
  another build's file, so only the runtime can name it.
- An exposed bundle holds every lazy route of the remote, so its bundle list would preload far
  more than a module needs; an exposed module gets its own map, and the runtime preloads only its
  `initial` rows.
- A map rather than a list, keyed by import name, so a runtime reads the name the built files use
  instead of deriving it from the file name. Lazy rows make the map complete enough to build an
  import map from: an entry file imports a lazy chunk by its bare `@nf-internal` name too.
- A shared or mapping record is an owner like an exposed module. A package in the combined bundle
  or a pool bundle shares that bundle with other packages, so a list per bundle would preload every
  member's chunks for one package, and the runtime would have to work out which chunks belong to
  which record. The map is per record, not per entry point, because a record is published and
  loaded as one unit.

## Rejected

- Sharing chunks across remotes by name or content hash: a chunk carries no version or scope that
  would make that safe.
- Publishing each chunk as a `shared` record of its own, with the bundler's relative imports
  left in exposed and mapping bundles (`features.denseChunking: false`, the 4.x default): a second
  shape for the same chunks, and a chunk record that looks like a package to the runtime.
- A top-level chunk list per bundle with a `bundle` name on each shared record (4.x
  `denseChunking`, the first 5.0 shape): a preload package in a combined or pool bundle preloaded
  every member's chunks, a lazy chunk preloaded with the static ones, and a package built in two
  bundles split into two records.
- One record per pool, a chunk table per pool or bundle, a top-level `{ name: file }` table with
  owners listing only names, or rows that refer to another record's: a pool is a build and
  election label, not a package. Each brings back a join between records. A record or table per
  pool loses a member's own `initial`, a name table keeps one fact in two places, and rows by
  reference leave a member served from another build without its chunks.

## Limits

- Code that a mapping and an exposed module both use is duplicated rather than split out.
- Every extra bundle costs build time and memory, so bundles are split only where the config asks.
- Every build lexes every published script, cached shared bundles included.
- Without code splitting, each entry point of a bundle inlines its own copy of the private files
  it shares with the other entry points (a relative import cannot be made external), so module
  state in those files exists once per entry point. `build: 'separate'` does this whatever
  `chunks` says. `pool` alone does not help: it couples which build serves the packages, not their
  files. A package whose entry points share private files needs `chunks` on in one bundle that
  holds them all: the combined bundle (the default), `build: 'package'` or `build: 'pool'`.
- An unshared dependency two packages with bundles of their own both import is inlined into each.
  `build: 'pool'` splits it into one chunk, but that keeps one instance only where one build
  serves the remote's whole pool in that share scope: the runtime may still publish a member the
  serving build does not ship from another build, with its own copy.
- Each member of a pool or the combined bundle lists the chunks of code no member shares that it
  reaches, so those rows repeat across members. Sharing that dependency removes them.

Enforced by: `src/lib/core/build/bundle-shared.spec.ts`,
`src/lib/core/build/bundle-exposed-and-mappings.spec.ts`,
`src/lib/core/output/chunk-closures.spec.ts`,
`src/lib/core/build/build-for-federation-chunks.spec.ts`,
`src/lib/core/build/shared-bundle-plan.spec.ts`
Issues: core#138, core#144, core#145, core#246, core#249
History: core#6 dense chunk list per bundle → core#141 content-named, shared by name → core#145
build-local, unshared, mappings built apart from exposed modules → 5.0 dense chunk list only,
`features.denseChunking` removed → 5.0 every exposed module and shared record lists its own
chunks; the per-bundle list and `bundle` removed
Related: [Mapping packages](mapping-packages.md), [Build adapter](build-adapter.md),
[Output files](output-files.md)
