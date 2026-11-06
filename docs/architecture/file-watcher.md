# File watcher

[Docs](../README.md) › Architecture

## Rules

- Core provides a watcher (`createNfWatcher`) that adapters can use to drive rebuilds. It
  reports changes both as a callback and as a set the adapter reads and clears. A host that
  already owns a watcher can inject it; an injected watcher must survive file replacement itself.
- Core provides what to watch: the inputs of the last build and the source folders of the
  mappings; the adapter passes them in. Files are watched through their directory, so a save that
  replaces the file is still seen.
- npm-linked shared packages are polled. This is opt-in (`watchLinkedDeps`), and core says what it
  is not watching.
- A replayed event is dropped only when the file is provably unchanged. Every ambiguous case is
  delivered.
- A watch that fails to open is reported, not swallowed.

## Why

- In watch mode a missed change is silent: the dev server keeps serving the last bundle until it
  is restarted, and a library that never reloads looks broken.
- Native file watching fails in the ways that matter here. Editors that save by replacing the file
  defeat per-file watches, npm-linked packages are rebuilt by replacing whole folders, and some
  platforms replay events for unchanged files, which keeps a rebuild loop busy. None of this is
  framework-specific, so every adapter would otherwise solve it again.
- A spurious rebuild is cheaper than a lost edit, so ambiguity resolves toward delivery.

## Rejected

- Running an injected watcher and core's own side by side: it adds API and catches nothing core's
  own watcher misses.

## Limits

- Events the platform itself drops, for example under heavy churn, are not recovered.

Enforced by: `src/lib/utils/file-watcher.spec.ts`, `src/lib/utils/io/node-io-adapter.spec.ts`
Issues: core#182, core#225
Related: [Shared cache](shared-cache.md) (linked packages), [Shared mappings](shared-mappings.md)
