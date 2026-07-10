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
- Testing with Vitest (currently not wired into CI)

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
├── src/                  → library source
└── dist/                 → build output (gitignored)
```

### Build

- `pnpm build` → runs `node esbuild.config.mjs` (transpiles every `src/**/*.ts`
  to a mirrored `dist/**/*.js`, preserving `./*.js` import specifiers) then
  `tsc -p tsconfig.build.json` (emits matching `.d.ts` files only).
- `pnpm typecheck` → `tsc -p tsconfig.build.json --noEmit`.
- `pnpm lint` → `eslint src`.
- `pnpm test` → `vitest` (left as-is; not part of CI).

esbuild does **not** emit declarations, so `tsc` owns `.d.ts` generation. Both
write into `dist/` with `rootDir: src`, so JS and types land side by side.

### Package exports (via `package.json` exports)

- `.` - Main build API: `federationBuilder`, `buildForFederation`, etc.
- `./config` - Configuration utilities: `withNativeFederation`, `shareAll`, `share`
- `./domain` - Type definitions and contracts
- `./internal` - Internal utilities (generally not for public use)

### Core responsibilities

- Parse and normalize federation configuration from `federation.config.js`
- Determine externals (dependencies that should not be bundled with main app)
- Bundle shared dependencies separately for caching
- Bundle exposed modules (remote entry points)
- Handle shared mappings (monorepo-internal libraries)
- Generate `remoteEntry.json` metadata files
- Manage federation cache for performance

**Important files**:

- `src/lib/core/federation-builder.ts` - Main API: `init()`, `build()`, `close()`
- `src/lib/core/build-for-federation.ts` - Initial build orchestration
- `src/lib/core/rebuild-for-federation.ts` - Incremental rebuild logic (watch mode)
- `src/lib/core/bundle-shared.ts` - Bundles shared dependencies
- `src/lib/core/bundle-exposed-and-mappings.ts` - Bundles exposed modules
- `src/lib/core/build-adapter.ts` - Adapter pattern for build tools (esbuild, rollup, etc.)
- `src/lib/config/with-native-federation.ts` - Configuration normalization
- `src/lib/config/share-utils.ts` - `shareAll()`, `share()` helpers
- `src/lib/config/remove-unused-deps.ts` - Tree-shakes unused shared dependencies

**Build Adapter Pattern**:
The core library is build-tool agnostic. It expects a `NFBuildAdapter` that implements bundling logic. Reference implementations use esbuild (see `@softarc/native-federation-esbuild` package, separate repo).

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

  sharedMappings: ['@my-org/*'], // Share specific monorepo libs

  chunks: true, // Enable code-splitting (default: true)

  features: {
    denseChunking: true, // Optimize remoteEntry.json structure
    denseExternals: true, // Group all entrypoints of a shared external under one object (opt-in)
    mappingVersion: true, // Use versions for shared mappings, is now opt-out
  },
});
```

### Important Configuration Options

- **`requiredVersion: 'auto'`**: Automatically reads version from nearest `package.json`
- **`includeSecondaries`**: Can be `true`, `false`, or `{ skip: ['...'], resolveGlob: true, keepAll: true }`
- **`singleton`**: Ensures only one instance of a dependency is loaded
- **`strictVersion`**: Throws error on version mismatch instead of loading multiple versions
- **`chunks`**: Can be set globally or per-package to control code-splitting
- **`build: 'package'`**: Bundle a shared dependency in isolation (not in the shared bundle)

## File Watching & Development

The library supports **watch mode** for development:

1. **Build notifications**: During development builds, the build process can optionally emit notifications
2. **Incremental rebuilds**: `rebuildForFederation()` re-bundles only what changed

**Key files**:

- `src/lib/domain/core/build-notification-options.contract.ts` - Contract for notifications
- `src/lib/core/rebuild-for-federation.ts` - Incremental rebuild logic

## Caching System

Native Federation uses an intelligent caching system to speed up builds:

**Federation Cache** (`src/lib/core/federation-cache.ts`):

- Caches built shared dependencies by content hash
- Reuses cached bundles when dependencies haven't changed
- Stored in `node_modules/.federation` by default
- Persisted across builds for fast rebuilds

**Cache invalidation**:

- Based on package version changes
- Based on configuration changes
- Can be manually cleared

## Testing

- Unit tests use Vitest and live alongside source files (`.spec.ts`).
- Run with `pnpm test` (`vitest`).
- Tests are **not currently part of CI** and the test config has only been
  de-Nx'd, not fully verified after the build migration.

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

### Error Handling

- Custom errors in `src/lib/utils/errors.ts`
- `AbortedError` for cancellation scenarios
- Descriptive error messages with context

### Logging

- Centralized logger in `src/lib/utils/logger.ts`
- Levels: `info`, `notice`, `warning`, `error`, `debug`
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

### Debugging Build Issues

1. Check `federation.config.js` configuration
2. Verify externals are properly excluded
3. Check federation cache in `node_modules/.federation`
4. Enable verbose logging in `federationBuilder.init({ options: { verbose: true } })`
5. Look at generated `remoteEntry.json` files
6. Check the import map in browser DevTools

### Understanding the Build Flow

1. Start at `src/lib/core/federation-builder.ts`
2. Follow `buildForFederation()` for initial build
3. Follow `rebuildForFederation()` for incremental builds
4. Check `bundleShared()` for shared dependency bundling
5. Check `bundleExposedAndMappings()` for exposed module bundling
6. See `writeFederationInfo()` for remoteEntry.json generation

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

## Key Architectural Decisions

1. **Build-tool agnostic**: Uses adapter pattern to support any bundler
2. **Framework agnostic**: No framework-specific code; works with vanilla JS, React, Angular, etc.
3. **Browser standards**: Leverages Import Maps and ES Modules instead of custom loaders
4. **Caching**: Aggressive caching of shared dependencies for performance
5. **Type safety**: Full TypeScript support with proper contract definitions

## Code Quality & Best Practices

- **Lint code**: `pnpm lint` (uses ESLint with TypeScript rules)
- **Type check**: `pnpm typecheck`
- **Conventional commits**: Use `feat:`, `fix:`, `docs:`, etc.
- **Keep PRs focused**: One feature or fix per PR
- **Update docs**: Keep README.md and AGENTS.md in sync with code changes

## Resources

- Main README: `/README.md` - User-facing documentation or the documentation website: https://native-federation.com/llms.txt
- Contributing guide: `/CONTRIBUTING.md` - Contribution guidelines
- Examples: See README for links to example repositories
- Angular blog: https://www.angulararchitects.io (articles on Module Federation)
