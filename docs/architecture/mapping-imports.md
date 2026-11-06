# Mapping imports

[Docs](../README.md) › Architecture

## Rules

- Core decides whether a relative import that lands inside a mapping can be rewritten to the
  mapping's import name; the adapter only applies the answer in its bundler's resolve hook.
  `createMappingImportResolver` (from `./internal`) returns the import name, or declines.
- It rewrites only when every runtime export of the imported file is exported by the mapping's
  entry point as the same binding, as TypeScript resolves it. Same name is not enough.
- When it cannot prove that, it declines, and the file stays inlined: duplication, never
  breakage. A decline is not an error; the resolver reports when the entry point does not carry
  the file, so the library author can export it.

## Why

- Mappings point at library source, so a compiler can emit a deep relative import into a mapping
  instead of its bare name. A relative import bypasses `external`, so the bundler inlines that
  file while the import map also serves the mapping: it is evaluated twice, and anything that
  relies on one instance breaks.
- Every adapter needs the same answer, so core owns the rule.
- A renamed or same-named export from another file would hand the app a different value, hence
  the binding check.

## Rejected

Recorded so they are not proposed again:

- Fixing it in the barrel: the compiler emits the same deep import either way.
- Failing the build on deep imports: it breaks working builds and blames the app author.
- Widening the mapping bundle to cover the file: it widens the remote's public surface, and the
  mapping is bundled before the app build that finds the import.
- Pointing mappings at compiled library output, which removes the cause: it needs a
  workspace-wide change to how libraries are built and consumed.
- Publishing the deep file itself: ruled out by the barrel rule in
  [Published imports](published-imports.md).

## Limits

- An adapter that does not use the resolver keeps the duplication.
- Cost: a TypeScript program over the mappings, built once per build.

Enforced by: `src/lib/config/mapping-imports.spec.ts`
Issues: core#122, core#133, core#134, core#227
History: core#124 resolver plus pre-compiled mappings (closed, split) → core#133 resolver that
checks each binding → core#227 resolves symlinked directories
Related: [Shared mappings](shared-mappings.md), [Published imports](published-imports.md)
