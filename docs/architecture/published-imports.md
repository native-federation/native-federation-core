# Published imports

[Docs](../README.md) › Architecture

## Rules

- Every bare import in the output resolves through the host's import map.
- Only barrel specifiers are published for mappings. A published mapping whose specifier looks
  like a file path fails the build.
- After `remoteEntry.json` is assembled, core reads every script the build wrote and checks each
  bare import against what `remoteEntry.json` declares, the keys of its owners' chunk maps and
  `externals`. Each finding is one of three kinds, and one rule decides whether it fails or warns:
  - an unresolved bare import warns, and fails the build with `features.strictImports`;
  - an `@nf-internal` chunk that no owner's chunk map lists fails a full build whatever
    `strictImports` says;
  - a script the check could not scan fails a full build whatever `strictImports` says.
- A watch rebuild without `strictImports` only warns, for every kind, so the dev loop keeps
  running; the next full build fails. A strict build, rebuild or not, fails on every finding.
- A watch rebuild whose specifiers are the same as the previous build's only notes how many there
  are. Unlisted chunks take part in that comparison like any other specifier; a file that could
  not be scanned has no specifier and is reported on every rebuild.
- The check reads the files in the output directory, so cached bundles are covered too, and it
  never passes a file it could not read.

## Why

- The import map only has the exact keys `remoteEntry.json` declares, while a bundler keeps
  every subpath of an external bare. A pruned or skipped entry point, or a deep import into a
  mapping, therefore builds fine and fails in the browser.
- The runtime builds the import map from `remoteEntry.json` alone, never from what the files
  import, so the build is the only place that can catch it, and a runtime "failed to resolve
  module specifier" becomes a build-time message.
- An import map does not resolve file-shaped specifiers reliably, hence barrels only.
- An ordinary unresolved import fails only with strict mode, which stays opt-in so existing
  configs keep building: a lazy import on a path that is never taken never fails at runtime.
- An unlisted chunk can never load: only core writes `@nf-internal` names, and the import map
  holds only the chunks an owner lists, so the miss is a build defect, not a config choice. It
  usually means the build adapter did not return a file it wrote, which only the adapter can
  fix.
- A script the check cannot scan is the only way the chunk-map walk misses an edge, so passing it
  would publish maps that may be incomplete.
- Specifiers, not importers, are compared across rebuilds because chunks are named after their
  content, so an edit renames the importers.

## Limits

- Only ES module imports with a literal specifier are read; CommonJS `require` and computed URLs
  are not checked.

Enforced by: `src/lib/core/output/validate-bare-imports.spec.ts`,
`src/lib/config/validate-mappings.spec.ts`
Issues: core#30, core#168, core#172, core#186, vitejs/vite#21036
Related: [Externals](externals.md), [Shared packages](shared-packages.md),
[Shared mappings](shared-mappings.md), [Output files](output-files.md),
[Mapping imports](mapping-imports.md)
