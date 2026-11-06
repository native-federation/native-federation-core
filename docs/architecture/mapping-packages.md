# Mapping packages

[Docs](../README.md) › Architecture

## Rules

- Mappings group into packages, and each package has one config and one version.
- A `mappingsFromWorkspace().package(prefix, cfg)` declaration decides first: every mapping at or
  under the prefix belongs to it, and the longest prefix wins.
- Without a declaration, the npm-style name (`@scope/name`) decides.
- A declaration is identity only: it does not change how or where the mappings are bundled.
- Packages that hold shared state and depend on each other are coupled explicitly with `pool`;
  core never infers coupling.
- The entry points of one package agree on their version; a mismatch fails the build before
  bundling.

## Why

- A package is published as one unit (see [Shared packages](shared-packages.md)). For shared
  packages from npm the package is obvious; for mappings it is not. Inferred from an npm-style
  name, it can group independent libraries whose names mark domains rather than packages, or
  split one library that the tsconfig lists as several exact keys. Either way a library ends up
  with two configs or versions, with no error.

## Rejected

- tsconfig `paths` keys as package identity: tools that write one exact key per entry point would
  split one library into packages served from different remotes.

## Limits

- Declarations belong in one module that every remote's config imports. Remotes that declare the
  same library differently publish it differently, and core cannot detect that.
- Without `denseExternals`, a host can still take one package's entry points from different
  remotes, as for any multi-entry library.

Enforced by: `src/lib/config/mapping-utils.spec.ts`, `src/lib/core/output/densify-externals.spec.ts`
Issues: core#198, core#213, core#214, core#215
History: core#206 per-mapping package field (closed) → core#208 `build: 'paths'` (4.9.0-next.1 only)
→ core#214 `.package(prefix, cfg)` → core#215 identity only, no own bundle
Related: [Shared packages](shared-packages.md), [Shared mappings](shared-mappings.md),
[Chunks](chunks.md)
