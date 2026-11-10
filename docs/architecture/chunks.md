# Chunks

[Docs](../README.md) › Architecture

## Rules

- Chunks are published as unshared and scoped to the remote that emitted them. A chunk name is
  only meaningful within its own build, not a share key.
- Chunks are named by a hash of the bytes they serve, so identical bytes keep one name across
  rebuilds and changed bytes always get a new one.
- Shared packages, mappings and exposed modules are bundled apart.
- Code splitting (`chunks`) is set per bundle; `build` gives a package a bundle of its own.
- Which packages share a chunk within one build is not promised; a shared chunk never creates
  more instances than inlining would. Coupling is done with `pool` (see Mapping packages).
- Each exposed module maps in `chunks` every file of its own build it reaches, directly or through
  each other: relative imports and this build's own `@nf-internal` chunks, static or a literal
  `import()`. Any other bare specifier ends the walk. A row is keyed by the file's import name
  (`@nf-internal/<name>`, with or without `denseChunking`) and holds `{ file, initial? }`;
  `initial: true` marks the files reached by static imports alone. A module that reaches none has
  no `chunks`. The map is computed from the output files on every build and rebuild.
- A shared package that sets `preload` preloads every chunk of the bundle it is built in, as the
  top-level `chunks` lists them; shared records carry no list of their own. Core warns when such a
  package is built in the combined bundle, or when `denseChunking` is off.

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
  import map from: a dense build imports a lazy chunk by its bare `@nf-internal` name too.
- The bundle list is already published, so a preload package reuses it. For a package with a
  bundle of its own (`build: 'package'`) it is close to what the package needs. In the combined
  bundle it is every package's chunks, hence the warning. A list per shared record would repeat
  file names the bundle list already holds, and differ per entry point, which splits a package in
  a runtime that densifies flat records.

## Rejected

- Sharing chunks across remotes by name or content hash: a chunk carries no version or scope that
  would make that safe.

## Limits

- Code that a mapping and an exposed module both use is duplicated rather than split out.
- Every extra bundle costs build time and memory, so bundles are split only where the config asks.
- A preload package's bundle list includes chunks it reaches only through a dynamic import, so a
  library that splits languages, themes or diagrams into lazy chunks preloads all of them.
- With flat chunking there is no bundle list, so a preload package preloads only its entry files.

Enforced by: `src/lib/core/build/bundle-shared.spec.ts`,
`src/lib/core/build/bundle-exposed-and-mappings.spec.ts`,
`src/lib/core/output/chunk-closures.spec.ts`,
`src/lib/core/build/build-for-federation-chunks.spec.ts`
Issues: core#138, core#144, core#145
History: core#6 dense chunk list per bundle → core#141 content-named, shared by name → core#145
build-local, unshared, mappings built apart from exposed modules
Related: [Mapping packages](mapping-packages.md), [Build adapter](build-adapter.md),
[Output files](output-files.md)
