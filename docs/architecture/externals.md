# Externals

[Docs](../README.md) › Architecture

## Rules

- Core defines how an import matches an external and exports the rule as `matchesExternal`
  (from `./internal`): a name also covers its subpaths, a single `*` is a wildcard, and the
  specifier is matched as written, never as a resolved path.
- Every bundle core plans and every check in core use this rule, and adapters apply it to every
  `external` they receive. An adapter for a bundler that matches externals exactly widens them,
  for example with a function that calls `matchesExternal`.
- `externals` in a federation config are opt-out specifiers: they stay bare imports and are never
  published in `remoteEntry.json`, because the host or another loader provides them.
- Imports an adapter adds itself (a dev client, a polyfill) are declared on the adapter and merged
  into the same list, so users do not repeat them.

## Why

- Core and the bundler both decide what is external: the bundler to leave an import bare, core to
  check that the import map will resolve it and to tell user externals from shared packages.
  Bundlers match externals differently, and when the two disagree, an import is left bare that
  nothing resolves at runtime, or inlined where it should have been shared.

## Rejected

- A separate list for adapter-added imports: such an import has to be external anyway, and one
  list with one rule cannot drift.

## Limits

- A broad external hides everything under it, including a shared package's entry points, so
  adapter externals should be exact or scoped.

Enforced by: `src/lib/utils/path-patterns.spec.ts`, `src/lib/core/normalize-options.spec.ts`
Issues: core#183, core#185, core#186
Related: [Build adapter](build-adapter.md), [Published imports](published-imports.md)
