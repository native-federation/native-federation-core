# Chunks

[Docs](../README.md) › Architecture

## Rules

- Chunks are published as unshared and scoped to the remote that emitted them. A chunk name is
  only meaningful within its own build, not a share key.
- Chunks are named by a hash of the bytes they serve, so identical bytes keep one name across
  rebuilds and changed bytes always get a new one.
- Shared packages, mappings and exposed modules are bundled apart.
- Code splitting (`chunks`) is set per bundle; `build` gives a package a bundle of its own.
  `build: 'combined'` keeps a package in the combined bundle, as no `build` does.
- Which packages share a chunk within one build is not promised; a shared chunk never creates
  more instances than inlining would. Coupling is done with `pool` (see Mapping packages).

## Why

- A chunk is code the bundler split out of one or more entry points. It has no package name,
  version or config of its own, so nothing downstream can tell whether the code it was split from
  asked to be a singleton, used a share scope, or was meant to stay private. A chunk the runtime
  shared by name could serve another build's bytes, or share state that was never meant to be
  shared.
- A chunk factored out of both a mapping and an exposed module would split one remote against
  itself, because the import map may serve that mapping from another remote.

## Rejected

- Sharing chunks across remotes by name or content hash: a chunk carries no version or scope that
  would make that safe.

## Limits

- Code that a mapping and an exposed module both use is duplicated rather than split out.
- Every extra bundle costs build time and memory, so bundles are split only where the config asks.

Enforced by: `src/lib/core/build/bundle-shared.spec.ts`,
`src/lib/core/build/bundle-exposed-and-mappings.spec.ts`
Issues: core#138, core#144, core#145
History: core#6 dense chunk list per bundle → core#141 content-named, shared by name → core#145
build-local, unshared, mappings built apart from exposed modules
Related: [Mapping packages](mapping-packages.md), [Build adapter](build-adapter.md),
[Output files](output-files.md)
