# Native Federation Core docs

Each page describes how one part of core works today: the rules it keeps, why, the alternatives
that were rejected, and the designs it replaced. A PR that changes a rule edits its page. A PR
that replaces a design also appends to History and moves the old design to Rejected.

Open the page for the part of the build you are about to change.

| Page                                                           | Open when                                                                                |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **1. Configuration**                                           |                                                                                          |
| [Workspace root](architecture/workspace-root.md)               | resolving any path or loading a config                                                   |
| [Shared packages](architecture/shared-packages.md)             | changing what is shared, at which version, or what is pruned                             |
| [Shared mappings](architecture/shared-mappings.md)             | changing how `sharedMappings` are read, selected or pruned                               |
| [Mapping packages](architecture/mapping-packages.md)           | changing how mappings group into packages, or `.package()`                               |
| [Mapping imports](architecture/mapping-imports.md)             | a mapped library is evaluated twice, or before proposing a fix for deep imports          |
| **2. Bundling**                                                |                                                                                          |
| [Build adapter](architecture/build-adapter.md)                 | writing or changing an adapter, or what core expects of its output                       |
| [Externals](architecture/externals.md)                         | touching `externals` or anything that asks "is this external?"                           |
| [Chunks](architecture/chunks.md)                               | changing which bundle code lands in, code splitting, or chunk names                      |
| **3. Output**                                                  |                                                                                          |
| [Output files](architecture/output-files.md)                   | reading, hashing or post-processing built files, or listing what a build wrote           |
| [Published imports](architecture/published-imports.md)         | an unresolved-import message, `strictImports` or the barrel rule is involved             |
| **4. Across builds**                                           |                                                                                          |
| [Shared cache](architecture/shared-cache.md)                   | changing the shared cache key, layout or invalidation, or what a failed shared run keeps |
| [File watcher](architecture/file-watcher.md)                   | watch mode misses saves or never settles, or touching the watcher                        |
| **5. Packaging**                                               |                                                                                          |
| [Public API](architecture/public-api.md)                       | adding, removing or renaming an export                                                   |
| [TypeScript dependency](architecture/typescript-dependency.md) | changing the `typescript` range or using a newer TypeScript API                          |
