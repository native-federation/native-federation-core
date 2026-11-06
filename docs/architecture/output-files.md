# Output files

[Docs](../README.md) › Architecture

## Rules

- Every bundle reports every file it wrote, chunks, source maps and assets included, on a rebuild
  too. Adapters write them flat into one output directory.
- That list is the single source for integrity hashes, import validation and adapter
  post-processing. It is exposed as `federationBuilder.outputFiles` and is never published.
- Before `remoteEntry.json` is written, core checks that the files it lists are still on disk, so
  a later bundle that deletes an earlier one's files is caught before anything is published.
- Adapters post-process from `outputFiles`, not from a glob or from `remoteEntry.json`.

## Why

- Core hashes, scans and publishes what the adapters write, and adapters post-process federation
  output (for example, copying it into locale folders). Each of these needs the same answer to
  "which files did this build produce?".
- Deriving that answer from `remoteEntry.json` misses files it does not name, and globbing the
  output directory picks up the application's own output too.

## Rejected

- Listing the files in the published `chunks` field: the runtime gives that field meaning.

## Limits

- A file an adapter does not report is neither hashed nor checked.

Enforced by: `src/lib/core/output/validate-output-files.spec.ts`,
`src/lib/core/cache/federation-cache.spec.ts`
Issues: core#177, core#178
Related: [Build adapter](build-adapter.md), [Published imports](published-imports.md),
[Shared cache](shared-cache.md), [Chunks](chunks.md)
