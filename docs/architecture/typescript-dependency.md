# TypeScript dependency

[Docs](../README.md) › Architecture

## Rules

- `typescript` is a regular dependency with a wide range, `>=5.0.0 <7`.
- 5.0 is the lowest version that has the module resolution core relies on. TypeScript 7 ships
  without the JS API.
- CI runs the suite a second time with the lowest version of the range installed, so the floor is
  tested, not assumed. Raising the floor is a deliberate change to the range.

## Why

- Every build needs TypeScript: core calls its API to read tsconfig files and resolve imports the
  way the compiler does.
- Workspaces that install core already have their own TypeScript, often pinned by their
  framework. Core must not decide which compiler a workspace uses, and it must not fail an install
  because the workspace's version differs from core's.
- Within the range, npm and pnpm reuse the workspace's copy. Outside it, a second copy is
  installed, which costs disk space but does not break anything.

## Rejected

- A peer dependency: npm fails an install when a peer range does not match instead of installing
  a second copy, which would block workspaces on another TypeScript version.

## Limits

- A TypeScript API newer than the floor fails the floor run only as far as the suite covers it.
- Supporting TypeScript 7 needs a different way to read tsconfigs, not a wider range.

Enforced by: `.github/workflows/verify.yml`
Issues: core#133, core#158, core#229
History: core#133 runtime dependency at ~6.0.0 (peer range rejected) → core#158 range >=5.0.0 <7 →
core#229 floor installed in CI, not aliased
Related: [Shared mappings](shared-mappings.md), [Public API](public-api.md)
