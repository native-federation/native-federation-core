# Shared mappings

[Docs](../README.md) › Architecture

## Rules

- A mapping is a monorepo library shared through tsconfig `paths`. Libraries from `node_modules`
  go through `shared`, not through mappings.
- Mappings come from the `paths` of the tsconfig the build compiles with, read with TypeScript's
  own API, so `extends` and `baseUrl` mean exactly what they mean to the compiler.
- `sharedMappings` selects from those keys by pattern, optionally with per-mapping settings;
  leaving it out shares every key.
- A mapping is pruned like a shared package: one that nothing in the build reaches, directly or
  through another mapping, is not published, unless the config keeps it.
- A pattern that selects nothing, or a tsconfig without the expected `paths`, is reported rather
  than publishing no mappings silently.
- Without a tsconfig there are no mappings; a `sharedMappings` pattern is then reported as
  selecting nothing.

## Why

- Monorepo libraries are not installed packages, so there is no `package.json` dependency to
  share. If core reads `paths` from a different file, or interprets them differently than the
  compiler does, the build still succeeds but a library is bundled into the app as well as
  shared, and runs twice at runtime.

## Limits

- Changing the `paths` of the build's tsconfig changes what a remote publishes.

Enforced by: `src/lib/config/project-paths.spec.ts`, `src/lib/config/mapped-paths.spec.ts`,
`src/lib/config/get-used-dependencies.spec.ts`
Issues: core#102, core#135, core#149, core#163
Related: [Workspace root](workspace-root.md), [Shared packages](shared-packages.md),
[Published imports](published-imports.md), [Mapping packages](mapping-packages.md),
[Mapping imports](mapping-imports.md), [TypeScript dependency](typescript-dependency.md)
