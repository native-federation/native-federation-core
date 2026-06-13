# @softarc/native-federation

Native Federation is a "browser-native" implementation of the successful mental model behind wepback Module Federation for building Micro Frontends and plugin-based solutions. It can be **used with any framework and build tool** for implementing **Micro Frontends** and plugin-based architectures.

> [!WARNING]
> **This is our v4 version**. For the v3 version, check out the [module-federation-plugin repository](https://github.com/angular-architects/module-federation-plugin/tree/main/libs/native-federation-core).

## Features

- ✅ Mental Model of Module Federation
- ✅ Future Proof: Independent of build tools like webpack and frameworks
- ✅ Embraces Import Maps -- an emerging browser technology -- and EcmaScript modules
- ✅ Easy to configure
- ✅ Blazing Fast: The reference implementation not only uses the fast esbuild; it also caches already built shared dependencies (like Angular itself). However, as mentioned above, feel free to use it with any other build tool.

## Stack

This library allows to augment your build process, to configure hosts (Micro Frontend shells) and remotes (Micro Frontends), and to load remotes at runtime.

While this core library can be used with any framework and build tool, there is a higher level API on top of it. It hooks into the Angular CLI and provides a builder and schematics:

![Stack](https://github.com/angular-architects/module-federation-plugin/raw/main/libs/native-federation-core/stack.png)

> Please find the [Angular-based version here](https://www.npmjs.com/package/@angular-architects/native-federation).

> Please find the [vite plugin here](https://www.npmjs.com/package/@gioboa/vite-module-federation).

Also, other higher level abstractions on top of this core library are possible.

## About the Mental Model

The underlying mental model allows for runtime integration: Loading a part of a separately built and deployed application into your host. This is needed for Micro Frontend architectures but also for plugin-based solutions.

For this, the mental model introduces several concepts:

- **Remote:** The remote is a separately built and deployed application. It can **expose EcmaScript** modules that can be loaded into other applications.
- **Host:** The host loads one or several remotes on demand. For your framework's perspective, this looks like traditional lazy loading. The big difference is that the host doesn't know the remotes at compilation time.
- **Shared Dependencies:** If a several remotes and the host use the same library, you might not want to download it several times. Instead, you might want to just download it once and share it at runtime. For this use case, the mental model allows for defining such shared dependencies.
- **Version Mismatch:** If two or more applications use a different version of the same shared library, we need to prevent a version mismatch. To deal with it, the mental model defines several strategies, like falling back to another version that fits the application, using a different compatible one (according to semantic versioning) or throwing an error.

## Example

- [VanillaJS example](https://github.com/manfredsteyer/native-federation-core-microfrontend).
- [React example](https://github.com/manfredsteyer/native-federation-react-example)
  - This example also shows the **watch mode** for compiling a federated application
- [Vite + Svelte example](https://github.com/gioboa/svelte-microfrontend-demo)
- [Vite + Angular example powered by AnalogJS](https://github.com/manfredsteyer/native-federation-vite-angular-demo)
- **Your Example:** If you have an example with aspects not covered here, let us know. We are happy to link it here.

## Credits

Big thanks to:

- [Zack Jackson](https://twitter.com/ScriptedAlchemy) for originally coming up with the great idea of Module Federation and its successful mental model
- [Florian Rappl](https://twitter.com/FlorianRappl) for an good discussion about these topics during a speakers dinner in Nuremberg
- [Michael Egger-Zikes](https://twitter.com/MikeZks) for contributing to our Module Federation efforts and brining in valuable feedback
- The Angular CLI-Team, esp. [Alan Agius](https://twitter.com/AlanAgius4) and [Charles Lyding](https://twitter.com/charleslyding), for working on the experimental esbuild builder for Angular

## Using this Library

### Installing the Library

```
npm i @softarc/native-federation
```

As Native Federation is tooling agnostic, we need an adapter to make it work with specific build tools. The package `@softarc/native-federation-esbuild` contains a simple adapter that uses esbuild.

```
npm i @softarc/native-federation-esbuild
```

You can also provide your own adapter by providing a function aligning with the `NFBuildAdapter` [[src](https://github.com/native-federation/native-federation-core/blob/main/src/lib/core/build-adapter.ts)] type.

### Augment your Build Process

> [!WARNING]
> The esbuild adapter is currently under construction, check the progress here: https://github.com/native-federation/esbuild-adapter

Just call three helper methods provided by our `federationBuilder` in your build process to adjust it for Native Federation.

```typescript
import * as esbuild from 'esbuild';
import * as path from 'path';
import * as fs from 'fs';
import { esBuildAdapter } from '@softarc/native-federation-esbuild';
import { federationBuilder } from '@softarc/native-federation';


const projectName = 'shell';
const tsConfig = 'tsconfig.json';
const outputPath = `dist/${projectName}`;

/*
 *  Step 1: Initialize Native Federation
*/
await federationBuilder.init({
    options: {
        workspaceRoot: path.join(__dirname, '..'),
        outputPath,
        tsConfig,
        federationConfig: `${projectName}/federation.config.js`,
        verbose: false,
    },

    /*
      * As this core lib is tooling-agnostic, you
      * need a simple adapter for your bundler.
      * It's just a matter of one function.
    */
    adapter: esBuildAdapter
});

/*
  * Step 2: Trigger your build process
  *
  * You can use any tool for this. Here, we go
  * with a very simple esbuild-based build.
  *
  * Just respect the externals in
  * `federationBuilder.externals`.
*/

[...]

await esbuild.build({
    [...]
    external: federationBuilder.externals,
    [...]
});

[...]

/*
  * Step 3: Let the build method do the additional tasks
  *   for supporting Native Federation
*/

await federationBuilder.build();
```

The method `federationBuilder.build` bundles the shared and exposed parts of your app.

### Configuring Hosts

The `withNativeFederation` function sets up a configuration for your applications. This is an example configuration for a host:

The `shareAll` helper shares all your dependencies defined in your `package.json`. The `package.json` is look up as described above:

```typescript
// shell/federation.config.js

import { withNativeFederation, shareAll } from '@softarc/native-federation/config';

export default withNativeFederation({
  name: 'host',

  shared: {
    ...shareAll({
      singleton: true,
      strictVersion: true,
      requiredVersion: 'auto',
      includeSecondaries: false,
    }),
  },
});
```

The options passed to shareAll are applied to all dependencies found in your `package.json`.

This might come in handy in an mono repo scenario and when doing some experiments/ trouble shooting.

> Since v21.1 it's also possible to add overrides to the shareAll for specific packages.

```typescript
// shell/federation.config.js

import { withNativeFederation, shareAll } from '@softarc/native-federation/config';

export default withNativeFederation({
  name: 'host',

  shared: {
    ...shareAll(
      {
        singleton: true,
        strictVersion: true,
        requiredVersion: 'auto',
      },
      {
        overrides: {
          'package-a/themes/xyz': {
            singleton: true,
            strictVersion: true,
            requiredVersion: 'auto',
            includeSecondaries: { skip: '@package-a/themes/xyz/*' },
            build: 'package',
          },
          'package-b': {
            singleton: false,
            strictVersion: true,
            requiredVersion: 'auto',
            includeSecondaries: { skip: 'package-b/icons/*' },
            build: 'package',
          },
        },
      }
    ),
  },
});
```

### Share Helper

The helper function share adds some additional options for the shared dependencies:

```typescript
shared: share({
    "package-a": {
        singleton: true,
        strictVersion: true,
        requiredVersion: 'auto',
        includeSecondaries: true
    },
    [...]
})
```

The added options are `requireVersion: 'auto'` and `includeSecondaries`.

#### requireVersion: 'auto'

If you set `requireVersion` to `'auto'`, the helper takes the version defined in your `package.json`.

This helps to solve issues with not (fully) met peer dependencies and secondary entry points (see Pitfalls section below).

By default, it takes the `package.json` that is closest to the caller (normally the `webpack.config.js`). However, you can pass the path to an other `package.json` using the second optional parameter. Also, you need to define the shared libray within the node dependencies in your `package.json`.

Instead of setting requireVersion to auto time and again, you can also skip this option and call `setInferVersion(true)` before:

```typescript
setInferVersion(true);
```

#### includeSecondaries

If set to `true`, all secondary entry points are added too. In the case of `@angular/common` this is also `@angular/common/http`, `@angular/common/http/testing`, `@angular/common/testing`, `@angular/common/http/upgrade`, and `@angular/common/locales`. This exhaustive list shows that using this option for `@angular/common` is not the best idea because normally, you don't need most of them.

> `includeSecondaries` is true by default.

However, this option can come in handy for quick experiments or if you want to quickly share a package like `@angular/material` that comes with a myriad of secondary entry points.

Even if you share too much, Native Federation will only load the needed ones at runtime. However, please keep in mind that shared packages can not be tree-shaken.

To skip some secondary entry points, you can assign a configuration option instead of `true`:

```typescript
shared: share({
    "@angular/common": {
        singleton: true,
        strictVersion: true,
        requiredVersion: 'auto',
        includeSecondaries: {
            skip: ['@angular/common/http/testing']
        }
    },
    [...]
})
```

By default, all entrypoints of a package are considered, you can disable expensive glob resolves using the `globResolve` property:

```typescript
shared: share({
      "package-a": {
        singleton: true,
        strictVersion: true,
        requiredVersion: "auto",
        includeSecondaries: {resolveGlob: true}
      },
    [...]
})
```

This is enabled by default but might not always desirable since it will create a bundle of every valid exported file it finds, **Therefore it is recommended not to disable the `ignoreUnusedDeps` feature**. If you want to specifically skip certain parts of the glob export, you can also use the wildcard in the skip section:

```typescript
shared: share({
      "package-a/themes/xyz": {
        singleton: true,
        strictVersion: true,
        requiredVersion: "auto",
        includeSecondaries: {skip: "package-a/themes/xyz/*", resolveGlob: true}
      },
    [...]
})
```

Finally, it's also possible to break out of the "removeUnusedDep" feature for specific externals if desired, for example when sharing a whole suite of interconnected external dependencies like @angular/core. This can be handy when you want to avoid the chance of cross-version secondary entrypoints being used by the different micro frontends. E.g. mfe1 uses @angular/core v20.1.0 and mfe2 uses @angular/core/rxjs-interop v20.0.8, then you might want to use consistent use of v20.1.0 so rxjs-interop should be exported by mfe1. The "keepAll" prop allows you to enforce this:

```typescript
shared: share({
      "@angular/core": {
        singleton: true,
        strictVersion: true,
        requiredVersion: "auto",
        includeSecondaries: {keepAll: true}
      },
    [...]
})
```

The API for configuring and using Native Federation is very similar to the one provided by our Module Federation plugin [@angular-architects/module-federation](https://www.npmjs.com/package/@angular-architects/native-federation). Hence, most the articles on it are also valid for Native Federation.

### Sharing

The `shareAll`-helper used here shares all dependencies found in your `package.json`. Hence, they only need to be loaded once (instead of once per remote and host). If you don't want to share all of them, you can opt-out of sharing by using the `skip` option:

```typescript
n
export default withNativeFederation({
  [...]

  // Don't share my-lib
  skip: [
    'my-lib'
  ]

  [...]
})
```

### Sharing Mapped Paths (Monorepo-internal Libraries)

Paths mapped in your `tsconfig.json` are shared by default too. While they are part of your (mono) repository, they are treaded like libraries:

```json
{
  "compilerOptions": {
    [...]
    "paths": {
      "shared-lib": [
        "libs/shared-lib/index.ts"
      ]
    }
  }
}
```

If you don't want to share (all of) them, put their names into the skip array (see above).

### Detemining which internal libraries are shared

In Nx/monorepo setups, Native Federation shares all libraries from your `tsconfig` path mappings by default.

If you only want to share selected mapped paths, you can use `sharedMappings` in your `federation.config.js`:

```js
module.exports = withNativeFederation({
  shared: {
    ...shareAll({
      singleton: true,
      strictVersion: true,
      requiredVersion: 'auto',
    }),
  },
  sharedMappings: ['@my-org/auth-lib', '@my-org/ui/*'],
});
```

Notes:

- `sharedMappings` is optional. If you omit it, all mapped paths are shared.
- You can use wildcard suffixes (for example, `@my-org/ui/*`) to include multiple mapped paths.
- `skip` still applies and can be used to exclude mapped paths even if they were selected via `sharedMappings`.
- Mapped paths are read from the workspace root tsconfig file: `tsconfig.base.json` if present, otherwise `tsconfig.json`.
- The workspace root is detected by searching upward from the current working directory until a `package.json` is found.

If you don't want to share libraries within a monorepo and also distribute them as built libraries with a version, disable the `mappingVersion` feature flag in your `federation.config.js`. This ensures that the corresponding versions from your buildable libraries are used.

```js
module.exports = withNativeFederation({
  shared: {
    ...shareAll({
      singleton: true,
      strictVersion: true,
      requiredVersion: 'auto',
    }),
  },
  sharedMappings: ['@my-org/auth-lib', '@my-org/ui/*'],
  features: {
    mappingVersion: false,
  },
});
```

If enabled, Native Federation tries to read the version from the mapped library's nearest `package.json`. By default this feature is set to `false`.

### Code-Splitting for Shared Dependencies

By default, Native Federation enables code-splitting (chunking) for shared dependencies. This means large libraries can be split into smaller chunks which reduces the overal size, improving initial load times.

You can configure code-splitting at two levels:

#### Global Setting

Use the `chunks` option in your `federation.config.js` to control the default behavior for all shared dependencies:

```js
module.exports = withNativeFederation({
  // Disable code-splitting globally
  chunks: false,

  shared: {
    ...shareAll({
      singleton: true,
      strictVersion: true,
      requiredVersion: 'auto',
    }),
  },
});
```

When `chunks` is set to `false` at the config level, all shared dependencies, shared mappings and exposed modules will be bundled as single files without code-splitting.

#### Per-Package Setting

You can also override the code-splitting behavior for individual packages in the `shared` configuration:

```js
module.exports = withNativeFederation({
  shared: {
    ...shareAll(
      {
        singleton: true,
        strictVersion: true,
        requiredVersion: 'auto',
      },
      overrides: {
        'large-lib': {
          singleton: true,
          strictVersion: true,
          requiredVersion: 'auto',
          chunks: false,
          build: 'package' // necessary for isolated bundles
        },
      }
    ),
    // Disable code-splitting for a specific package

  },
});
```

> **Note:** When setting `chunks` on individual packages, consider also setting `build: 'package'` to avoid your explicit chunk settings being ignored since all 'default' bundles are bundled in a single build step.

#### Dense Chunking

The `denseChunking` feature flag optimizes the `remoteEntry.json` file structure for better performance:

```js
module.exports = withNativeFederation({
  shared: {
    ...shareAll({
      singleton: true,
      strictVersion: true,
      requiredVersion: 'auto',
    }),
  },
  features: {
    denseChunking: true,
  },
});
```

When enabled, instead of listing each chunk as a separate shared dependency, chunks are grouped by bundle name in a dedicated `chunks` object. Each shared dependency gets a `bundle` property linking it to its chunk bundle. This results in a smaller `remoteEntry.json` and allows chunks to be skipped if the dependency is not used in the final import map.

### Configuring Remotes

When configuring a remote, you can expose files that can be loaded into the shell at runtime:

```javascript
import { withNativeFederation, shareAll } from '@softarc/native-federation/config';

export default withNativeFederation({
  name: 'mfe1',

  exposes: {
    './component': './mfe1/component',
  },

  shared: {
    ...shareAll({
      singleton: true,
      strictVersion: true,
      requiredVersion: 'auto',
      includeSecondaries: false,
    }),
  },
});
```

### Loading Remotes at Runtime

This core library covers the **build side** of Native Federation. The generated `remoteEntry.json` files are consumed at runtime by a separate, framework-agnostic package: **[`@softarc/native-federation-orchestrator`](https://github.com/native-federation/orchestrator)**. It loads micro frontends built with Native Federation into any web page — SPAs as well as server-rendered hosts (PHP, Java, Rails, …) that reload on navigation.

#### Quickstart (drop-in script)

For a zero-build integration, declare your remotes in a manifest and include the quickstart bundle:

```html
<!-- Optional: enable shim mode for older browsers -->
<script type="esms-options">
  { "shimMode": true }
</script>

<!-- Define your micro frontends -->
<script type="application/json" id="mfe-manifest">
  {
    "team/mfe1": "http://localhost:3000/remoteEntry.json",
    "team/mfe2": "http://localhost:4000/remoteEntry.json"
  }
</script>

<!-- Load modules once the orchestrator is ready -->
<script>
  window.addEventListener(
    'mfe-loader-available',
    (e) => {
      e.detail.loadRemoteModule('team/mfe1', './Button');
      e.detail.loadRemoteModule('team/mfe2', './Header');
    },
    { once: true }
  );
</script>

<!-- Include the orchestrator -->
<script src="https://unpkg.com/@softarc/native-federation-orchestrator@4.3.0/quickstart.mjs"></script>
```

The `mfe-loader-available` event signals that the orchestrator has fetched the
remote metadata, resolved dependencies and set up the import map, so
`loadRemoteModule` is ready to use.

#### Programmatic API

For full control, install the package and initialize federation yourself:

```
npm i @softarc/native-federation-orchestrator
```

```typescript
import { initFederation } from '@softarc/native-federation-orchestrator';
import { consoleLogger, localStorageEntry } from '@softarc/native-federation-orchestrator/options';

const manifest = {
  'team/mfe1': 'http://localhost:3000/remoteEntry.json',
  'team/mfe2': 'http://localhost:4000/remoteEntry.json',
};

const { loadRemoteModule, load } = await initFederation(manifest, {
  logLevel: 'error',
  logger: consoleLogger,
  storage: localStorageEntry,
});

const ButtonComponent = await load('team/mfe1', './Button');
const HeaderComponent = await loadRemoteModule('team/mfe2', './Header');
```

The manifest maps logical remote names to their `remoteEntry.json` URLs (the
files generated by the build steps above). Entries can also be objects carrying
an `integrity` hash for Subresource Integrity. Manifests let you adjust your
application to different environments without recompilation.

#### Import maps & polyfills

The orchestrator uses **native browser import maps by default**, so no polyfill
is required for modern browsers. To support older browsers that lack import-map
support, add the [`es-module-shims`](https://github.com/guybedford/es-module-shims)
polyfill and opt into shim mode:

```typescript
import 'es-module-shims';
import { initFederation } from '@softarc/native-federation-orchestrator';
import { useShimImportMap } from '@softarc/native-federation-orchestrator/options';

const { loadRemoteModule } = await initFederation(manifest, {
  ...useShimImportMap({ shimMode: true }),
});
```

> For server-side rendering, the event registry, version-conflict resolution and
> security / Trusted Types, see the
> [orchestrator documentation](https://github.com/native-federation/orchestrator#readme).

## React and Other CommonJS Libs

Native Federation uses Web Standards like EcmaScript Modules. Most libs and frameworks support them meanwhile. Unfortunately, React still uses CommonJS (und UMD). We do our best to convert these libs to EcmaScript Modules. In the case of React there are some challenges due to the dynamic way the React bundles use the `exports` object.

As the community is moving to EcmaScrpt Modules, we expect that these issues will vanish over time. In between, we provide some solutions for dealing with CommonJS-based libraries using `exports` in a dynamic way.

One of them is `fileReplacemnts`:

```javascript
import { reactReplacements } from '@softarc/native-federation-esbuild/src/lib/react-replacements';
import { createEsBuildAdapter } from '@softarc/native-federation-esbuild';

[...]

createEsBuildAdapter({
  plugins: [],
  fileReplacements: reactReplacements.prod
})
```

Please note that the adapter comes with `fileReplacements` settings for React for both, `dev` mode and `prod` mode. For similar libraries you can add your own replacements. Also, using the `compensateExports` property, you can activate some additional logic for such libraries to make sure the exports are not lost

```javascript
createEsBuildAdapter({
  plugins: [],
  fileReplacements: reactReplacements.prod,
  compensateExports: [new RegExp('/my-lib/')],
});
```

The default value for `compensateExports` is `[new RegExp('/react/')]`.

## More: Blog Articles

Find out more about our work including Micro Frontends and Module Federation but also about alternatives to these approaches in our [blog](https://www.angulararchitects.io/en/aktuelles/the-microfrontend-revolution-part-2-module-federation-with-angular/).

## More: Angular Architecture Workshop (100% online, interactive)

In our [Angular Architecture Workshop](https://www.angulararchitects.io/en/angular-workshops/advanced-angular-enterprise-architecture-incl-ivy/), we cover all these topics and far more. We provide different options and alternatives and show up their consequences.

[Details: Angular Architecture Workshop](https://www.angulararchitects.io/en/angular-workshops/advanced-angular-enterprise-architecture-incl-ivy/)
