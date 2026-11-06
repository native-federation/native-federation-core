# Published imports

[Docs](../README.md) › Architecture

## Rules

- Every bare import in the output resolves through the host's import map.
- Only barrel specifiers are published for mappings. A published mapping whose specifier looks
  like a file path fails the build.
- After `remoteEntry.json` is assembled, core reads every script the build wrote and checks each
  bare import against what `remoteEntry.json` declares, its chunks and `externals`. It warns by
  default and fails the build with `features.strictImports`.
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
- Strict mode is opt-in, so existing builds are not broken by a minor release.

## Limits

- Only ES module imports with a literal specifier are read; CommonJS `require` and computed URLs
  are not checked.

Enforced by: `src/lib/core/output/validate-bare-imports.spec.ts`,
`src/lib/config/validate-mappings.spec.ts`
Issues: core#30, core#168, core#172, core#186, vitejs/vite#21036
Related: [Externals](externals.md), [Shared packages](shared-packages.md),
[Shared mappings](shared-mappings.md), [Output files](output-files.md),
[Mapping imports](mapping-imports.md)
