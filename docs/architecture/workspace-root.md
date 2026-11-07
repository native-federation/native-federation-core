# Workspace root

[Docs](../README.md) › Architecture

## Rules

- What a build writes and reads is resolved against `workspaceRoot`: the output path (which may
  also be absolute), exposed entry points, the `package.json` a config's `share()` calls read, the
  tsconfig used for shared mappings, and the scan for unused dependencies.
- A relative `workspaceRoot` is resolved against the working directory once, during normalization.
- The output does not depend on the directory the build starts in: all of it lands in one
  directory, so `remoteEntry.json` always sits next to the files it names.
- Paths an adapter owns, such as the tsconfig it compiles with, are passed through as given and
  resolved by the adapter.

## Why

- Build tools start core from different directories: the repository root, a project folder, or
  wherever a monorepo task runner happens to run. When some paths are read against
  `process.cwd()` and others against the workspace, the same build writes files to two places or
  reads another project's `package.json` and tsconfig, and still succeeds.

## Limits

- The config context (workspace root, `package.json`, tsconfig) is process-global, because a
  config file reads it while it evaluates. v5 can pass it explicitly instead.
- A few config-time lookups keep a working-directory fallback for compatibility, so a setup that
  resolved correctly before does not change.

Enforced by: `src/lib/config/configuration-context.spec.ts`,
`src/lib/config/project-paths.spec.ts`, `src/lib/core/build/bundle-exposed-and-mappings.spec.ts`
Issues: core#112, core#156, core#161
Related: [Shared mappings](shared-mappings.md)
