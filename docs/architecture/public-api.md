# Public API

[Docs](../README.md) › Architecture

## Rules

- The package exports five entry points: `.` (the build API), `./config` (for federation
  configs), `./domain` (types and contracts), `./internal` and `./internal/browser`.
- `./internal` and `./internal/browser` are for adapters and the runtime, not app configs, and may
  change between minor versions, never stable within a major. A consumer of either pins core to a
  minor version (`~`).
- `./internal/browser` is the browser-safe part of `./internal`. It and `./domain` load no Node
  built-in or package at runtime, so the runtime can import them.
- Something is exported only when it has a known consumer, or a contract tells adapters to use it.
  Review enforces this, not the snapshot.
- Every export of every entry point is snapshotted. Adding, removing or renaming an export means
  updating the snapshot on purpose.
- On `.`, `./config` and `./domain`, removals go through a deprecation and land in a major
  version. A type that appears in a stable signature is stable, whatever entry point exports it.

## Why

- Adapters, app configs and the runtime import from core, each for a different purpose and with
  different stability needs.
- When exports grow without anyone deciding to add them, every helper becomes something someone
  may depend on, and a later cleanup turns into a breaking change. The snapshot makes every
  surface change a reviewed diff.

## Limits

- The orchestrator still imports `./internal/browser` under a `^4.8.0` range rather than `~`.

Enforced by: `src/public-api.spec.ts`
Issues: core#157, core#226
Related: [Build adapter](build-adapter.md), [TypeScript dependency](typescript-dependency.md)
