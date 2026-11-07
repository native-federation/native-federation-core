# Build adapter

[Docs](../README.md) › Architecture

## Rules

- Core plans the bundles (what is shared, mapped and exposed) and post-processes what comes out:
  import rewriting, content naming, integrity, `remoteEntry.json`. An `NFBuildAdapter` does the
  bundling.
- Core imports no bundler and contains no framework-specific code.
- Adapter output follows a contract core can check: ES modules, written flat into the one output
  directory core hands it, with every written file reported back. The exact rules live in
  `build-adapter.contract.ts`, next to the fields they apply to.
- When core needs a fact only the bundler knows, the adapter reports it through an optional
  contract field; core does not guess per bundler.

## Why

- Native Federation is used with esbuild, the Angular CLI and other bundlers, and with any
  framework. If core bundled code itself, it would have to pick one of each, and every other
  setup would need a fork.
- What a remote publishes must look the same whatever built it, so the post-processing stays in
  core.

## Rejected

- Guessing per bundler from its conventions (file naming, chunk naming, output layout): they
  differ, and a wrong guess fails silently. A contract field states the answer instead.

## Limits

- Core checks the adapter's obligations only where it reads the output, not at compile time.
- Core still matches entries by file name when an adapter does not name them. An adapter that
  sets `entry` replaces that match, and the fallback goes away once the field is required in v5.
- Without `entry` or `externalsCacheKey` core warns, once per adapter; v5 requires both.

Enforced by: `src/lib/core/build/bundle-shared.spec.ts`, `src/lib/core/build/build-result-map.spec.ts`,
`src/lib/core/build/bundle-exposed-and-mappings.spec.ts`
Issues: core#200, core#203, core#204, core#218, core#219
Related: [Externals](externals.md), [Output files](output-files.md),
[Shared cache](shared-cache.md), [Chunks](chunks.md)
