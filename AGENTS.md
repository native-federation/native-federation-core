<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

# General Guidelines for working with Nx

- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- You have access to the Nx MCP server and its tools, use them to help the user
- When answering questions about the repository, use the `nx_workspace` tool first to gain an understanding of the workspace architecture where applicable.
- When working in individual projects, use the `nx_project_details` mcp tool to analyze and understand the specific project structure and dependencies
- For questions around nx configuration, best practices or if you're unsure, use the `nx_docs` tool to get relevant, up-to-date docs. Always use this instead of assuming things about nx configuration
- If the user needs help with an Nx configuration or project graph error, use the `nx_workspace` tool to get any errors

<!-- nx configuration end-->

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
- Uses esbuild for bundling (via adapters)
- Built with Nx monorepo tooling
- Uses pnpm workspaces
- Testing with Vitest (including browser tests with Playwright)

## Repository Structure

This is an **Nx monorepo** with three main packages:

```
packages/
├── core/              → @softarc/native-federation
├── runtime/           → @softarc/native-federation-runtime
└── node/              → @softarc/native-federation-node
```

### Package Breakdown

#### 1. `@softarc/native-federation` (core)

**Purpose**: Build-time functionality for configuring and bundling federated applications

**Key exports** (via `package.json` exports):

- `.` - Main build API: `federationBuilder`, `buildForFederation`, etc.
- `./config` - Configuration utilities: `withNativeFederation`, `shareAll`, `share`
- `./domain` - Type definitions and contracts
- `./internal` - Internal utilities (generally not for public use)

**Core responsibilities**:

- Parse and normalize federation configuration from `federation.config.js`
- Determine externals (dependencies that should not be bundled with main app)
- Bundle shared dependencies separately for caching
- Bundle exposed modules (remote entry points)
- Handle shared mappings (monorepo-internal libraries)
- Generate `remoteEntry.json` metadata files
- Manage federation cache for performance
- Support both browser and Node.js platforms

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

#### 2. `@softarc/native-federation-runtime` (runtime)

**Purpose**: Runtime functionality for loading federated modules in the browser

**Key exports**:

- `initFederation()` - Initialize federation runtime, load remoteEntry.json files
- `loadRemoteModule()` - Dynamically load a module from a remote
- `watchFederationBuildCompletion()` - Watch for remote build notifications during development

**Core responsibilities**:

- Fetch and parse `remoteEntry.json` metadata from host and remotes
- Construct ES Module import maps with proper scoping
- Inject import maps into the DOM (uses `es-module-shims` polyfill)
- Manage version matching for shared dependencies
- Handle remote module loading with proper error handling
- Support hot-reload / live-reload during development

**Important files**:

- `src/lib/init-federation.ts` - Main entry point for federation initialization
- `src/lib/load-remote-module.ts` - Dynamic remote module loading
- `src/lib/model/import-map.ts` - Import map construction and merging
- `src/lib/model/remotes.ts` - Remote registration and management
- `src/lib/model/externals.ts` - External dependency resolution
- `src/lib/utils/add-import-map.ts` - DOM injection of import maps
- `src/lib/watch-federation-build.ts` - Development mode file watching

**Import Map Structure**:

```typescript
{
  imports: {
    // Host shared deps at root level
    "react": "./shared/react.js",
    // Exposed modules from remotes
    "mfe1/Component": "http://localhost:3001/exposed/Component.js"
  },
  scopes: {
    // Remote-specific shared deps (for version isolation)
    "http://localhost:3001/": {
      "react": "http://localhost:3001/shared/react.js"
    }
  }
}
```

#### 3. `@softarc/native-federation-node` (node)

**Purpose**: Node.js-specific federation support (SSR, testing)

**Key exports**:

- `initNodeFederation()` - Initialize federation in Node.js context

**Core responsibilities**:

- Provide Node.js-compatible federation initialization
- Custom loader hooks for Node.js module resolution
- Support for server-side rendering scenarios

**Important files**:

- `src/lib/node/init-node-federation.ts` - Node.js federation init
- `src/lib/utils/fstart.ts` - Federation start utilities

## Key Workflows

### Build-Time Workflow (using `@softarc/native-federation`)

1. **Initialize**: `federationBuilder.init({ options, adapter })`
   - Parses `federation.config.js`
   - Normalizes configuration (resolves `auto` versions, etc.)
   - Determines externals list

2. **Main Application Build**: User's build tool bundles the app
   - Must respect `federationBuilder.externals` (exclude them from main bundle)

3. **Federation Build**: `federationBuilder.build()`
   - Bundles shared dependencies (with caching)
   - Bundles exposed modules
   - Bundles shared mappings (monorepo libs)
   - Generates `remoteEntry.json` metadata
   - Writes import map for development

4. **Watch Mode**: `federationBuilder.build({ modifiedFiles })`
   - Incrementally rebuilds only changed modules
   - Uses federation cache to skip unchanged dependencies

### Runtime Workflow (using `@softarc/native-federation-runtime`)

1. **Initialize**: `await initFederation({ mfe1: 'http://localhost:3001/remoteEntry.json' })`
   - Loads host's `remoteEntry.json`
   - Loads each remote's `remoteEntry.json`
   - Merges import maps
   - Injects `<script type="importmap-shim">` into DOM

2. **Load Remote**: `await loadRemoteModule({ remoteName: 'mfe1', exposedModule: './Component' })`
   - Resolves module URL via import map
   - Uses dynamic `import()` to load the module
   - Returns the module exports

## Configuration

### `federation.config.js` Structure

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
    mappingVersion: true, // Use versions for shared mappings
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
2. **Runtime watching**: `watchFederationBuildCompletion()` can listen for these notifications
3. **Live reload**: When a remote rebuilds, the runtime can reload the affected modules

**Key files**:

- `packages/core/src/lib/domain/core/build-notification-options.contract.ts` - Contract for notifications
- `packages/runtime/src/lib/watch-federation-build.ts` - Runtime watcher implementation

## Caching System

Native Federation uses an intelligent caching system to speed up builds:

**Federation Cache** (`packages/core/src/lib/core/federation-cache.ts`):

- Caches built shared dependencies by content hash
- Reuses cached bundles when dependencies haven't changed
- Stored in `node_modules/.federation` by default
- Persisted across builds for fast rebuilds

**Cache invalidation**:

- Based on package version changes
- Based on configuration changes
- Can be manually cleared

## Testing

### Unit Tests

- Use Vitest
- Run with: `nx test <package-name>`
- Located alongside source files (`.spec.ts`)

### Integration Tests

- Browser-based tests using Vitest + Playwright
- Located in `packages/runtime/src/lib/*.integration.spec.ts`
- Test actual federation scenarios with MSW (Mock Service Worker)
- Run with: `nx test:integration runtime`

### E2E Tests

- Full end-to-end tests in `packages/runtime`
- Run with: `pnpm test:e2e:runtime`
- Uses real browser environments

**Test helpers** in `packages/runtime/src/lib/__test-helpers__/`:

- `federation-fixtures.ts` - Mock remoteEntry.json data
- `module-fixtures.ts` - Mock module content
- `msw-handlers.ts` - MSW request handlers
- `dom-helpers.ts` - DOM manipulation utilities

## Common Patterns & Conventions

### Import Paths

- **Always use `.js` extensions** in imports, even for `.ts` files (ESM requirement)
- Relative imports for same-package files: `'./utils/logger.js'`
- Cross-package imports use the package name: `'@softarc/native-federation/domain'`

### Contracts (Domain Types)

- Type definitions are in `packages/core/src/lib/domain/`
- Organized by concern: `core/`, `config/`, `utils/`
- Files named `*.contract.ts` contain interfaces and types
- Exported via `packages/core/src/domain.ts`

### Error Handling

- Custom errors in `packages/core/src/lib/utils/errors.ts`
- `AbortedError` for cancellation scenarios
- Descriptive error messages with context

### Logging

- Centralized logger in `packages/core/src/lib/utils/logger.ts`
- Levels: `info`, `notice`, `warning`, `error`, `debug`
- Performance measurements with `logger.measure(start, message)`

### File Naming

- Source files: lowercase with hyphens (e.g., `build-for-federation.ts`)
- Test files: same name with `.spec.ts` or `.integration.spec.ts`
- Contract files: `*.contract.ts`
- Utility files grouped in `utils/` directories

## Common Tasks for AI Assistants

### Adding a New Feature

1. Determine which package it belongs to (core = build-time, runtime = runtime, node = Node.js)
2. Add implementation files in `packages/<pkg>/src/lib/`
3. Export from appropriate entry point (`index.ts`, `config.ts`, etc.)
4. Add tests alongside implementation
5. Update types in `domain/` if needed
6. Run `nx lint <package>` and fix issues
7. Test with `nx test <package>`

### Debugging Build Issues

1. Check `federation.config.js` configuration
2. Verify externals are properly excluded
3. Check federation cache in `node_modules/.federation`
4. Enable verbose logging in `federationBuilder.init({ options: { verbose: true } })`
5. Look at generated `remoteEntry.json` files
6. Check the import map in browser DevTools

### Debugging Runtime Issues

1. Inspect injected import map: `document.querySelector('script[type="importmap-shim"]')`
2. Check browser console for failed module loads
3. Verify `remoteEntry.json` is accessible and valid
4. Check CORS headers for cross-origin remotes
5. Verify version matching for shared dependencies
6. Enable debugging: `localStorage.setItem('debug', 'nf:*')`

### Understanding the Build Flow

1. Start at `packages/core/src/lib/core/federation-builder.ts`
2. Follow `buildForFederation()` for initial build
3. Follow `rebuildForFederation()` for incremental builds
4. Check `bundleShared()` for shared dependency bundling
5. Check `bundleExposedAndMappings()` for exposed module bundling
6. See `writeFederationInfo()` for remoteEntry.json generation

### Understanding the Runtime Flow

1. Start at `packages/runtime/src/lib/init-federation.ts`
2. Follow `loadFederationInfo()` to see how remoteEntry.json is loaded
3. Check `processHostInfo()` for host-side processing
4. Check `fetchAndRegisterRemotes()` for remote-side processing
5. See `mergeImportMaps()` for import map construction
6. Check `loadRemoteModule()` for dynamic loading

## Version Management

- Versions are managed in individual `package.json` files
- Core and runtime should stay in sync (both currently `4.0.0-RC10`)
- Uses conventional commits for changelog generation
- Release process: update versions, build, publish to npm

## External Dependencies & Ecosystem

This core library is designed to work with:

- **[@softarc/native-federation-esbuild](https://github.com/native-federation/esbuild-adapter)** - esbuild adapter (separate repo)
- **[@angular-architects/native-federation](https://www.npmjs.com/package/@angular-architects/native-federation)** - Angular-specific integration
- **[@gioboa/vite-module-federation](https://www.npmjs.com/package/@gioboa/vite-module-federation)** - Vite plugin

The core library is intentionally low-level and agnostic; higher-level integrations provide framework-specific conveniences.

## Key Architectural Decisions

1. **Build-tool agnostic**: Uses adapter pattern to support any bundler
2. **Framework agnostic**: No framework-specific code; works with vanilla JS, React, Angular, etc.
3. **Browser standards**: Leverages Import Maps and ES Modules instead of custom loaders
4. **Caching**: Aggressive caching of shared dependencies for performance
5. **Type safety**: Full TypeScript support with proper contract definitions
6. **Monorepo structure**: Separation of concerns (build vs. runtime vs. Node.js)

## Code Quality & Best Practices

- **Always run tests** before committing: `nx affected:test`
- **Lint code**: `nx affected:lint` (uses ESLint with TypeScript rules)
- **Type check**: Build process validates types
- **Conventional commits**: Use `feat:`, `fix:`, `docs:`, etc.
- **Keep PRs focused**: One feature or fix per PR
- **Update docs**: Keep README.md and AGENTS.md in sync with code changes

## Resources

- Main README: `/README.md` - User-facing documentation
- Contributing guide: `/CONTRIBUTING.md` - Contribution guidelines
- Examples: See README for links to example repositories
- Angular blog: https://www.angulararchitects.io (articles on Module Federation)
