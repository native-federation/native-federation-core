# Native Federation Core - AI Assistant Guide

## Project Overview

**Native Federation** is a browser-native implementation of the Module Federation mental model for building Micro Frontends. Unlike webpack Module Federation, this library is **framework-agnostic** and **build-tool-agnostic**, leveraging browser-native technologies like **ES Modules** and **Import Maps**.

### Key Concepts

- **Remote**: A separately built and deployed application that exposes ES modules for consumption by other apps
- **Host**: An application (shell) that loads remotes on demand at runtime
- **Shared Dependencies**: Libraries shared between host and remotes to avoid duplicate downloads
- **Import Maps**: Browser-native technology used to map module specifiers to URLs
- **remoteEntry.json**: Metadata file generated during build containing information about exposed modules and shared dependencies

### Technology Stack

- Written in TypeScript with ES Modules (`.js` extensions in imports)
- Provides build-time helpers for federating apps via a build-tool adapter (e.g. esbuild)
- **Built with raw esbuild** (`esbuild.config.mjs`) for JS, plus `tsc` for `.d.ts` declarations
- Single package published from the repository root; managed with pnpm
- Testing with Vitest, run in CI (`.github/workflows/verify.yml`)
- `typescript` is a runtime dependency ranged `>=5.0.0 <7`
  ([TypeScript dependency](docs/architecture/typescript-dependency.md))

## Repository Structure

This is a **single-package repository** published as `@softarc/native-federation`.

```
/
├── package.json          → @softarc/native-federation (exports → ./dist/*)
├── esbuild.config.mjs    → raw esbuild build (1:1 transpile, bundle: false)
├── tsconfig.json         → base compiler options
├── tsconfig.build.json   → emitDeclarationOnly → dist
├── tsconfig.spec.json    → test typings
├── eslint.config.mts
├── vite.config.ts        → vitest config
├── docs/                → architecture topics (map: docs/README.md)
├── src/                  → library source
└── dist/                 → build output (gitignored)
```

### Build

- `pnpm build` → runs `node esbuild.config.mjs` (transpiles every `src/**/*.ts`
  to a mirrored `dist/**/*.js`, preserving `./*.js` import specifiers) then
  `tsc -p tsconfig.build.json` (emits matching `.d.ts` files only).
- `pnpm typecheck` → `tsc -p tsconfig.build.json --noEmit`.
- `pnpm lint` → `eslint src`.
- `pnpm test` → `vitest`, run in CI twice: as is and on the TypeScript floor.

esbuild does **not** emit declarations, so `tsc` owns `.d.ts` generation. Both
write into `dist/` with `rootDir: src`, so JS and types land side by side.

### Package exports (via `package.json` exports)

- `.` - Main build API: `federationBuilder`, `buildForFederation`, etc.
- `./config` - Configuration utilities: `withNativeFederation`, `shareAll`, `share`
- `./domain` - Type definitions and contracts (browser-safe)
- `./internal` - Adapter-facing helpers (`matchesExternal`, the file watcher, `toDiskCase`); not
  for app configs, may change between minors
- `./internal/browser` - The browser-safe subset of `./internal`

See [Public API](docs/architecture/public-api.md).

### Core responsibilities

- Parse and normalize federation configuration from `federation.config.mjs`
- Determine externals (dependencies that should not be bundled with main app)
- Bundle shared dependencies separately for caching
- Bundle exposed modules (remote entry points)
- Handle shared mappings (monorepo-internal libraries)
- Generate `remoteEntry.json` metadata files
- Manage federation cache for performance

**Important files**:

- `src/lib/core/federation-builder.ts` - Main API: `init()`, `build()`, `close()`
- `src/lib/core/build/build-for-federation.ts` - Initial build orchestration
- `src/lib/core/build/rebuild-for-federation.ts` - Incremental rebuild logic (watch mode)
- `src/lib/core/build/bundle-shared.ts` - Bundles shared dependencies
- `src/lib/core/build/bundle-exposed-and-mappings.ts` - Bundles shared mappings and exposed modules
- `src/lib/domain/core/build-adapter.contract.ts` - The adapter contract
- `src/lib/core/cache/` - Shared cache (on disk) and federation cache (in memory)
- `src/lib/core/output/` - `remoteEntry.json` assembly, output checks
- `src/lib/config/with-native-federation.ts` - Configuration normalization
- `src/lib/config/share-utils.ts` - `shareAll()`, `share()` helpers
- `src/lib/config/remove-unused-deps.ts` - Prunes unused shared dependencies

## Architecture

Each page in `docs/architecture/` describes how one part of core works today. A PR that changes a
rule edits its page; a PR that replaces a design also appends to History and moves the old design
to Rejected. Open the page before changing what it covers. This table mirrors
[docs/README.md](docs/README.md).

| Page                                                                | Open when                                                                                |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **1. Configuration**                                                |                                                                                          |
| [Workspace root](docs/architecture/workspace-root.md)               | resolving any path or loading a config                                                   |
| [Shared packages](docs/architecture/shared-packages.md)             | changing what is shared, at which version, or what is pruned                             |
| [Shared mappings](docs/architecture/shared-mappings.md)             | changing how `sharedMappings` are read, selected or pruned                               |
| [Mapping packages](docs/architecture/mapping-packages.md)           | changing how mappings group into packages, or `.package()`                               |
| [Mapping imports](docs/architecture/mapping-imports.md)             | a mapped library is evaluated twice, or before proposing a fix for deep imports          |
| **2. Bundling**                                                     |                                                                                          |
| [Build adapter](docs/architecture/build-adapter.md)                 | writing or changing an adapter, or what core expects of its output                       |
| [Externals](docs/architecture/externals.md)                         | touching `externals` or anything that asks "is this external?"                           |
| [Chunks](docs/architecture/chunks.md)                               | changing which bundle code lands in, code splitting, or chunk names                      |
| **3. Output**                                                       |                                                                                          |
| [Output files](docs/architecture/output-files.md)                   | reading, hashing or post-processing built files, or listing what a build wrote           |
| [Published imports](docs/architecture/published-imports.md)         | an unresolved-import message, `strictImports` or the barrel rule is involved             |
| **4. Across builds**                                                |                                                                                          |
| [Shared cache](docs/architecture/shared-cache.md)                   | changing the shared cache key, layout or invalidation, or what a failed shared run keeps |
| [File watcher](docs/architecture/file-watcher.md)                   | watch mode misses saves or never settles, or touching the watcher                        |
| **5. Packaging**                                                    |                                                                                          |
| [Public API](docs/architecture/public-api.md)                       | adding, removing or renaming an export                                                   |
| [TypeScript dependency](docs/architecture/typescript-dependency.md) | changing the `typescript` range or using a newer TypeScript API                          |

## Configuration

### `federation.config.mjs` Structure

```javascript
import { withNativeFederation, shareAll } from '@softarc/native-federation/config';

export default withNativeFederation({
  name: 'mfe1', // Application name

  exposes: {
    // Modules to expose (remotes only)
    './Component': './src/Component.ts',
  },

  shared: {
    // Shared dependencies
    ...shareAll({
      // Share all package.json deps
      singleton: true, // Only one version loaded
      strictVersion: true, // Fail on version mismatch
      requiredVersion: 'auto', // Read from package.json
      includeSecondaries: false, // Include secondary entry points
    }),
  },

  skip: ['some-lib'], // Skip sharing certain libs

  externals: ['host-sdk'], // Left as a bare import but never published; something else provides it

  sharedMappings: ['@my-org/*'], // Share monorepo libs matching a pattern (omit to share all)

  chunks: true, // Enable code-splitting (default: true)

  features: {
    denseChunking: true, // Optimize remoteEntry.json structure
    denseExternals: true, // Group all entry points of a shared package under one object (opt-in)
    mappingVersion: true, // Use versions for shared mappings, is now opt-out
    strictImports: false, // Fail the build, instead of warning, on a bare import remoteEntry.json does not declare
  },
});
```

### Option notes

- **`requiredVersion: 'auto'`**: reads the version from the nearest `package.json`.
- **`singleton`** / **`strictVersion`**: one instance of a dependency / throw on a version mismatch.
- **`includeSecondaries`**: `true`, `false` or `{ skip, resolveGlob, keepAll }`. On a shared package
  `keepAll` keeps every secondary of a package something reaches; on a `sharedMappings` entry
  `true` or `keepAll` exempts the mapping from pruning entirely.
- **`chunks`** / **`build`**: code splitting is a property of a bundle. On a shared package
  `chunks` only applies together with a `build`; a mapping gets its own bundle with
  `build: 'separate'` or `'package'`. `build: 'combined'` is the same as no `build`.
- **`.only(patterns)`** narrows either builder's selection; `.filter()` is the same method, and
  calls of both union.
- **`fromPackageJson(...).patch()`** merges field by field in call order;
  **`mappingsFromWorkspace().patch()`** emits first-match-wins entries.
- **`preload`**: on a shared package, asks the runtime to fetch it, with every chunk of the bundle it
  is built in, once the import map is in place, before anything imports it.
- **`externals`**: specifiers left bare and never published; something else provides them.
- **`sharedMappings`**: patterns over the tsconfig `paths` the build compiles with; only barrel
  specifiers can be published.
- **`mappingsFromWorkspace().package(prefix, cfg?)`**: declares a mapping package (one config, one
  version).

## Writing an adapter

Detail lives in `src/lib/domain/core/build-adapter.contract.ts`; the why in
[Build adapter](docs/architecture/build-adapter.md) and [Externals](docs/architecture/externals.md).

- Write ESM, flat into `outdir`; core reads only ESM syntax.
- `build` returns every file it wrote, chunks, source maps and assets included, on a rebuild too.
- Read `external` the way `matchesExternal` does; widen bundler externals that match exactly.
- Imports the adapter adds itself go in `NFBuildAdapter.externals`, passed via `NFAdapterInput`
  when the adapter normalizes the config itself.
- Write each entry as its `outName`, or set `entry` on its result.
- `setup` receives the bundle's `kind`; `isMappingOrExposed` and `optimizedMappings` are deprecated.
- Declare `externalsCacheKey`; implement `cacheData` only if you need data from a cached build.
- Map relative imports into a shared mapping with `createMappingImportResolver`
  ([Mapping imports](docs/architecture/mapping-imports.md)).

## Watch mode

During development builds core can emit build notifications, and `rebuildForFederation()`
re-bundles only what changed. Adapters can drive their rebuild loop with core's watcher
([File watcher](docs/architecture/file-watcher.md)). A consumer that only
uses the `onChange` listener must still call `clear()`, or the dirty set grows for the process
lifetime.

**Key files**:

- `src/lib/domain/core/build-notification-options.contract.ts` - Contract for notifications
- `src/lib/core/build/rebuild-for-federation.ts` - Incremental rebuild logic
- `src/lib/utils/file-watcher.ts` - `createNfWatcher` / `syncNfFileWatcher`

## Testing

- Unit tests use Vitest and live alongside source files (`.spec.ts`).
- Run with `pnpm test` (`vitest`).
- `src/public-api.spec.ts` snapshots every entry point's exports. A surface change fails it until
  the snapshot is updated (`vitest -u`), so the change is reviewed as a diff.
- CI runs the suite a second time on the TypeScript floor (last step of `verify.yml`). To repeat it
  locally, run the same commands, then `git checkout package.json pnpm-lock.yaml && pnpm install`.
- CI runs the suite on pushes to `main` and on pull requests against `main` (a stacked PR is
  checked once it is retargeted), so a flaky spec blocks merges: fix it rather than retrying it.

## Common Patterns & Conventions

### Import Paths

- **Always use `.js` extensions** in imports, even for `.ts` files (ESM requirement)
- Relative imports for same-package files: `'./utils/logger.js'`
- Consumers import via the package name: `'@softarc/native-federation/domain'`

### Contracts (Domain Types)

- Type definitions are in `src/lib/domain/`
- Organized by concern: `core/`, `config/`, `utils/`
- Files named `*.contract.ts` contain interfaces and types
- Exported via `src/domain.ts`

### Filesystem access

- Code in `src/lib/core` and `src/lib/config` never imports `fs`, `crypto` or the glob library: it
  receives an `IoPort` (`nodeIo` in production, an in-memory port in specs). That keeps the build
  logic testable without a real disk, failure cases included. Enforced by `eslint.config.mts`.
- An exported helper that touches the filesystem takes no port, so adapters never build one; its
  `*Core` variant keeps the port and stays out of the public entry points.

### Build state

- State a build's correctness depends on lives on `FederationCache` itself, never in a
  module-private table keyed by the cache object: a copy (`{ ...cache }`) would silently lose it.
  Only state that controls how often a warning repeats may sit in such a table.

### Error Handling

- Custom errors in `src/lib/utils/errors.ts`
- `AbortedError` for cancellation scenarios
- Descriptive error messages with context

### Logging

- Centralized logger in `src/lib/utils/logger.ts`
- Levels: `info`, `notice`, `warn`, `error`, `verbose` (shown only in verbose mode)
- Performance measurements with `logger.measure(start, message)`

### File Naming

- Source files: lowercase with hyphens (e.g., `build-for-federation.ts`)
- Test files: same name with `.spec.ts`
- Contract files: `*.contract.ts`
- Utility files grouped in `utils/` directories

## Common Tasks for AI Assistants

### Adding a New Feature

1. Add implementation files in `src/lib/`
2. Export from appropriate entry point (`index.ts`, `config.ts`, etc.)
3. Add tests alongside implementation
4. Update types in `domain/` if needed
5. Run `pnpm lint` and fix issues
6. Run `pnpm build` to verify it compiles and emits declarations
7. Comments are fine but be very conservative. Only comment what's really important (the why).
8. If the change alters a rule, edit its page in `docs/architecture/`; if it replaces a design,
   also append to History and move the old design to Rejected ([docs/README.md](docs/README.md)).

### Debugging Build Issues

1. Check `federation.config.mjs` configuration
2. Verify externals are properly excluded
3. Check the shared cache in `node_modules/.cache/native-federation`
4. Enable verbose logging in `federationBuilder.init({ options: { verbose: true } })`
5. Look at generated `remoteEntry.json` files
6. Check the import map in browser DevTools

### Understanding the Build Flow

1. Start at `src/lib/core/federation-builder.ts`
2. Follow `buildForFederation()` for initial build
3. Follow `rebuildForFederation()` for incremental builds
4. Check `bundleShared()` for shared dependency bundling
5. Check `bundleExposedAndMappings()` for exposed module bundling
6. See `writeFederationInfo()` (`src/lib/core/output/`) for remoteEntry.json generation

## Version Management

- Version is managed in the root `package.json`
- Uses conventional commits for changelog generation
- Release process: update version, build, publish to npm (published from root, `files: ["dist"]`)

## External Dependencies & Ecosystem

This core library is designed to work with:

- **[@softarc/native-federation-orchestrator](https://github.com/native-federation/orchestrator)** - Runtime orchestrator that loads the `remoteEntry.json` output of this library into a host page (replaces the former `@softarc/native-federation-runtime`/`-node` packages)
- **[@softarc/native-federation-esbuild](https://github.com/native-federation/esbuild-adapter)** - esbuild adapter (separate repo)
- **[@angular-architects/native-federation](https://www.npmjs.com/package/@angular-architects/native-federation)** - Angular-specific integration

This package covers the **build side** only; runtime loading of remotes is handled by the orchestrator. The core library is intentionally low-level and agnostic; higher-level integrations provide framework-specific conveniences.

## Code Quality & Best Practices

- **Lint code**: `pnpm lint` (uses ESLint with TypeScript rules)
- **Type check**: `pnpm typecheck`
- **Conventional commits**: Use `feat:`, `fix:`, `docs:`, etc.
- **Keep PRs focused**: One feature or fix per PR
- **Update docs**: Keep README.md, AGENTS.md and `docs/` in sync with code changes

## Resources

- Main README: `/README.md` - User-facing documentation or the documentation website: https://native-federation.com/llms.txt
- Architecture topics: `/docs/README.md`
- Contributing guide: `/CONTRIBUTING.md` - Contribution guidelines
- Examples: See README for links to example repositories
- Angular blog: https://www.angulararchitects.io (articles on Module Federation)
