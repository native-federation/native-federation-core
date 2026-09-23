# @softarc/native-federation

[![npm version](https://img.shields.io/npm/v/@softarc/native-federation)](https://www.npmjs.com/package/@softarc/native-federation)
[![npm downloads](https://img.shields.io/npm/dm/@softarc/native-federation)](https://www.npmjs.com/package/@softarc/native-federation)
[![license](https://img.shields.io/npm/l/@softarc/native-federation)](https://github.com/native-federation/native-federation-core/blob/main/LICENSE.md)

The build-tool and framework agnostic core of **Native Federation**: the mental model of Module Federation, implemented on browser standards (ES modules and import maps) for Micro Frontends and plugin-based architectures.

📖 **[Documentation](https://native-federation.com/docs/v4/core/)**

> [!NOTE]
> This is **v4**. Upgrading? See the [migration guide](https://native-federation.com/docs/v4/migration/). The v3 source lives in the [module-federation-plugin repository](https://github.com/angular-architects/module-federation-plugin/tree/21.x.x/libs/native-federation-core).

## Features

- **Any framework, any bundler** — the core talks to your bundler through a small [adapter contract](https://native-federation.com/docs/v4/core/build-adapters/).
- **Web standards** — remotes are plain ES modules wired together by an import map, no custom loader necessary (polyfill support via es-module-shims).
- **Shared dependencies** — load a library once across host and remotes, with semver-aware version negotiation.
- **Fast** — shared dependencies are bundled once and cached across builds.

## Which package do I need?

This package is the low-level builder. Most apps use it through an adapter:

| You are…                               | Use                                                                                                     |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Building an Angular app                | [`@angular-architects/native-federation`](https://native-federation.com/docs/v4/angular-adapter/)       |
| Building with esbuild (React, vanilla) | [`@softarc/native-federation-esbuild`](https://native-federation.com/docs/v4/adapters/esbuild/)         |
| Loading remotes into a host page       | [`@softarc/native-federation-orchestrator`](https://native-federation.com/docs/v4/orchestrator/)        |
| Wiring a custom stack or new adapter   | this package — [build your own adapter](https://native-federation.com/docs/v4/adapters/build-your-own/) |

## Install

```bash
npm i @softarc/native-federation
```

## Usage

Describe what an application shares and exposes in `federation.config.(m)js`:

```js
import { withNativeFederation, fromPackageJson } from '@softarc/native-federation/config';

export default withNativeFederation({
  name: 'mfe1',
  exposes: {
    './component': './mfe1/component',
  },
  shared: fromPackageJson({
    singleton: true,
    strictVersion: true,
    requiredVersion: 'auto',
  }),
});
```

Then wrap your own build with the three `federationBuilder` calls:

```js
import * as esbuild from 'esbuild';
import { federationBuilder } from '@softarc/native-federation';
import { esBuildAdapter } from '@softarc/native-federation-esbuild';

await federationBuilder.init({
  options: {
    workspaceRoot: process.cwd(),
    outputPath: 'dist/mfe1',
    tsConfig: 'tsconfig.json',
    federationConfig: 'mfe1/federation.config.js',
  },
  adapter: esBuildAdapter,
});

// Run your bundler, keeping the shared dependencies external
await esbuild.build({ /* ... */ external: federationBuilder.externals });

// Bundle shared + exposed modules and write remoteEntry.json
await federationBuilder.build();
```

The resulting `remoteEntry.json` is loaded at runtime by the [orchestrator](https://native-federation.com/docs/v4/orchestrator/).

For the full walkthrough, see [Getting Started](https://native-federation.com/docs/v4/core/getting-started/) or the end-to-end [tutorial](https://native-federation.com/docs/v4/tutorial/).

## Documentation

- [Mental model](https://native-federation.com/docs/v4/mental-model/) — hosts, remotes and shared dependencies
- [Configuration](https://native-federation.com/docs/v4/core/configuration/) — every option on `withNativeFederation`
- [Sharing dependencies](https://native-federation.com/docs/v4/core/sharing/) — `fromPackageJson`, `share`, `shareAll`, secondary entry points
- [Build process](https://native-federation.com/docs/v4/core/build-process/) — the builder lifecycle and watch mode
- [Build artifacts](https://native-federation.com/docs/v4/core/artifacts/) — what ends up in `remoteEntry.json`
- [API reference](https://native-federation.com/docs/v4/core/api-reference/)
- [FAQ](https://native-federation.com/docs/v4/faq/)

Using an AI coding assistant? Point it at [`llms.txt`](https://native-federation.com/llms.txt).

## Contributing

Issues and pull requests are welcome — see [CONTRIBUTING.md](https://github.com/native-federation/native-federation-core/blob/main/CONTRIBUTING.md).

## Credits

Big thanks to [Zack Jackson](https://twitter.com/ScriptedAlchemy) for originally coming up with Module Federation and its mental model, and to [Florian Rappl](https://twitter.com/FlorianRappl) and the [Angular Architects team](https://www.angulararchitects.io/en/) for their feedback and contributions. Find the current team behind native-federation on our [documentation website](https://native-federation.com/team/).

## License

[MIT](https://github.com/native-federation/native-federation-core/blob/main/LICENSE.md)
