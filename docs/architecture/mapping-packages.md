# Mapping packages

[Docs](../README.md) › Architecture

## Rules

- Only a `mappingsFromWorkspace().package(prefix, cfg)` declaration groups mappings into a
  package, with one config and one version: every mapping at or under the prefix belongs to it,
  and the longest prefix wins.
- Every other mapping is a package of its own, with its own config, version and record, published
  under its own import name whatever that name looks like.
- A declaration is identity only: it does not change how or where the mappings are bundled.
- A mapping record is an ordinary shared record, with `entries` and its own `chunks`
  (see [Chunks](chunks.md)).
- Mappings of one declared package built in different bundles that split publish separate
  records under the package name. The bundle name only groups them; it is never published.
- Packages that hold shared state and depend on each other are coupled explicitly with `pool`;
  core never infers coupling.
- The entry points of one package agree on their version; a mismatch fails the build before
  bundling.

## Why

- A package is published as one unit (see [Shared packages](shared-packages.md)). For shared
  packages from npm the package is obvious; for mappings it is not. Inferred from an npm-style
  name, it can group independent libraries whose names mark domains rather than packages, or
  split one library that the tsconfig lists as several exact keys. Either way a library ends up
  with two configs or versions, with no error. Only the user knows which libraries form one
  package, so only a declaration groups them.

## Rejected

- Grouping undeclared mappings under their npm-style name (`@scope/name`, 4.x): independent
  libraries such as `@org/ui/table` and `@org/ui/button` published one `@org/ui` record when they
  agreed, and two `@org/ui` records at different versions when they did not, which a host reads as
  one package with a version conflict.
- tsconfig `paths` keys as package identity: tools that write one exact key per entry point would
  split one library into packages served from different remotes.

## Limits

- Splitting mapping records by bundle is kept from 4.x as it is. Shared packages built in two
  bundles already publish one record, so the two kinds of record group differently for now.
- Declarations belong in one module that every remote's config imports. Remotes that declare the
  same library differently publish it differently, and core cannot detect that.
- A mapping name that is not npm-style warns, unless a declaration covers it; it never fails the
  build.

Enforced by: `src/lib/config/mapping-utils.spec.ts`, `src/lib/core/output/densify-externals.spec.ts`,
`src/lib/core/build/mapping-bundle-plan.spec.ts`,
`src/lib/core/build/bundle-exposed-and-mappings.spec.ts`
Issues: core#198, core#213, core#214, core#215
History: core#206 per-mapping package field (closed) → core#208 `build: 'paths'` (4.9.0-next.1 only)
→ core#214 `.package(prefix, cfg)` → core#215 identity only, no own bundle → 5.0 only a
declaration groups mappings
Related: [Shared packages](shared-packages.md), [Shared mappings](shared-mappings.md),
[Chunks](chunks.md)
