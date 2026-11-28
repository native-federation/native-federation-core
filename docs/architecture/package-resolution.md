# Package resolution

[Docs](../README.md) › Architecture

How core turns a shared package name and entry point (`rxjs`, `rxjs/operators`) into the file it
bundles. The result is a `PackageInfo` whose `entryPoint` the adapter bundles for the shared
package and the unused-dependency scan reads for transitive imports. Entry: `getPackageInfo` in
`src/lib/utils/package/package-info.ts` for a shared bundle and `findInstalledPackage` in
`src/lib/config/get-used-dependencies.ts` for the scan. Both end in `resolveInstalledPackageInfo`
in `src/lib/utils/package/entry-point-resolver.ts`.

Core follows Node's `exports` resolution ([Node: Package entry points][node-exports],
[Node: resolution algorithm][node-algo]) wherever it can, and differs on purpose in the places
listed under [Differences from Node](#differences-from-node).

## Rules

### Reading the package

- For a shared bundle, core looks for the package from one folder: the workspace root, or the
  folder of `fedOptions.packageJson` when it is set (`bundleSharedCore`). `getPackageJsonFiles`
  lists that folder only when it holds a `package.json`; without one, nothing resolves. From
  there `findDepPackageJson` walks up through the `node_modules` folders to the package's own
  `package.json`. The scan picks the install it reads as
  [Which install the unused-dependency scan reads](#which-install-the-unused-dependency-scan-reads)
  describes.
- `version` comes from the package root's `package.json`. Without one, the package is not
  resolved. A secondary entry point gets the same version as its package.
- The entry point is split into the package and a subpath: `rxjs` is `.`, `rxjs/operators` is
  `./operators`.

### Strategy chain

`resolvePackageInfo` tries these in order (`STRATEGIES`), and the first that returns a file wins:

1. The root `package.json` `exports`, as the rest of this page describes.
2. The root `module`, for `.` only.
3. `module` of the subpath's own `package.json` (`<package>/<subpath>/package.json`).
4. `<subpath>/index.mjs`.
5. `main` of the subpath's own `package.json`.
6. `<subpath>/index.js`, then `<subpath>.js`, then `<subpath>.mjs`.

A strategy that finds nothing hands over to the next one. "Not exported" (see
[Not exported](#not-exported)) ends the chain: core never falls back to `module`, `main` or a
conventional file for an entry point the package blocks. Steps 2 to 6 exist for packages without
`exports`, or without a key for the subpath (see [Limits](#limits)).

The result's `esm` flag comes from the condition when it names a format (`import` true, `require`
false), is true for a `module` field or an `index.mjs`, and otherwise follows the package's
`"type"`.

### Exports sugar

- A string, an array, or an object without any key that starts with `.` is the entry of `.` (Node:
  [exports sugar][node-sugar], `isConditionalExportsMainSugar` in [`resolve.js`][node-sugar-impl]).
  Such a field has no key for any other subpath (see [Differences from Node](#differences-from-node)
  for what core does with one).

### Key matching

`resolveExportsEntry` in `src/lib/utils/package/exports-resolver.ts` picks the key, as Node's
`PACKAGE_IMPORTS_EXPORTS_RESOLVE` and `PATTERN_KEY_COMPARE` do ([spec][node-algo],
`packageExportsResolve` and `patternKeyCompare` in [`resolve.js`][node-per]):

- An exact key wins over any pattern, wherever it is listed.
- A pattern is a key with exactly one `*` ([Node: subpath patterns][node-patterns]). A key with two
  is not a pattern, so no subpath without a `*` matches it.
- Of the patterns that match, the one with the longest text before its `*` wins. A tie goes to the
  longer key. Two different keys that both match cannot tie on both.
- Text after the `*` is a suffix the subpath must end with (`./*.js` matches `./foo.js`, not
  `./foo`).
- The part the `*` matches is never empty: `./*` does not match `.`, and `./a/*` does not match
  `./a/`.
- Every `*` in the target, also in nested conditions and arrays, is replaced by that part
  (`replaceGlob`). `./*` → `./dist/*/*.js` maps `./x` to `./dist/x/x.js`.

### Target selection

`findOptimalExport` walks the matched value to one file:

- **String.** Valid when it starts with `./` and no later segment, split on `/` or `\`, is `.`, `..`
  or `node_modules` in any case. That is Node's rule (`invalidSegmentRegEx` and
  `resolvePackageTargetString` in [`resolve.js`][node-target-string]). An invalid string is not
  exported. Validity is read from the string alone.
- **Array.** The first element that resolves wins. An element is skipped when it is `null`, invalid,
  or a conditions object that resolves nothing or resolves to `null` or an invalid target. When no
  element resolves, the entry point is not exported (`resolvePackageTarget` in
  [`resolve.js`][node-target]; [spec][node-algo] `PACKAGE_TARGET_RESOLVE`).
- **`null`.** Not exported, at the subpath or under the condition that wins
  ([Node: subpath exports][node-subpath]).
- **Conditions object.** See [Conditions](#conditions). When the walk resolves nothing and the
  object has `default: null`, the entry point is not exported. Otherwise nothing resolved, and the
  chain moves on to `module`.
- **Any other value** (a number, a boolean) is invalid and not exported. Node rejects it too.

### Conditions

Core picks one key of a conditions object in its own order:

1. The first ESM key (`import`, `module-sync`, `module`, `esm`, `es20xx`; `isESMExport` in
   `src/lib/utils/package/esm-detection.ts`). If no key under it matches, the walk goes on to
   step 2.
2. `default`, when it is set.
3. Otherwise the first key that is not `types`, not the other platform's key, and not the ESM key
   step 1 tried.

Inside a key that names a format (an ESM key, or `require`, `cjs`, `commonjs`), step 1 is skipped.

Node walks the keys in the order the package lists them and takes the first that is `default` or
in its set of active conditions ([Node: conditional exports][node-conditions],
`resolvePackageTarget` in [`resolve.js`][node-target]). A condition outside that set, such as
`react-native` or `worker`, is never taken. See [Differences from Node](#differences-from-node) for where the two orders give
different files.

### Platform

- The platform is `browser` or `node`. A browser entry never takes a `node` key, and a node entry
  never takes a `browser` key ([Node: community conditions][node-community]).
- A shared bundle resolves its packages with its own `platform` (`bundleSharedCore` passes
  `buildOptions.platform`).
- The unused-dependency scan (`addTransientDeps` in `src/lib/config/get-used-dependencies.ts`)
  reads a specifier that is a key of `shared` with that entry's `platform`. Any other specifier, a
  transitive dependency or a secondary entry point that is not itself a key, is read with the
  config's top-level `platform`, and with `browser` when the config sets none.

### Which install the unused-dependency scan reads

`addTransientDeps` in `src/lib/config/get-used-dependencies.ts` scans the entry file of every
package the app imports, and of every package those import, so a shared package reached only
through another package is kept. `findInstalledPackage` picks the install it reads:

- A package a workspace file imports is looked up from the workspace root.
- A shared package is looked up from the workspace root, whoever imports it. That is the copy
  `bundleSharedCore` builds and every importer loads at runtime.
- A package that is not shared, imported by another package, is looked up from the importer's
  directory first, walking up through each parent's `node_modules` as Node does
  ([Node: loading from node_modules folders][node-modules-lookup]; [spec][node-algo]
  `PACKAGE_RESOLVE` step 10; `packageResolve` in [`resolve.js`][node-package-resolve]). It is
  looked up from the workspace root only when the importer sees no install of it.
- The first install the importer sees decides. When its `exports` block the entry point, or it has
  no `version` or no entry file, the package is not scanned, and the workspace root's install is
  not read in its place. Node also stops at the first `node_modules/<name>` it finds.
- The importer's directory is the real path of the folder that holds its `package.json`, with
  symlinks resolved. Under an isolated install a package's dependencies sit next to its real
  folder, not next to the symlink in the app's `node_modules`
  ([pnpm: symlinked node_modules structure][pnpm-symlinks]). Node resolves a module's imports from
  its real path too, unless `--preserve-symlinks` is set (`finalizeResolution` in
  [`resolve.js`][node-finalize-realpath]).
- The walk skips an entry file it has already scanned, compared by real path, not a package name it
  has seen. Two installs of one package, such as two versions that `a` and `b` each depend on, can
  import different things, and both are followed. The result is a set of package names.
- Each install is read with the platform [Platform](#platform) gives it.

### Not exported

- "Not exported" is the separate value `NOT_EXPORTED`, so `null` keeps meaning "try the next
  strategy".
- For a shared package, `getPackageInfo` warns
  `No meta data found for shared lib <name>: its package.json exports blocks this entry point`,
  then `Skip it in your federation.config.js, or remove it from shared`, and the entry point is not
  bundled. A package that is not found at all gets the first sentence without the reason, and the
  advice to skip it or move it into `devDependencies`.
- The scan skips a package in either case, without a warning.

### Examples

Checked by hand against Node 24.16 `packageExportsResolve`, not by CI, with the conditions
`browser`, `import`, `default` (browser) and `node`, `import`, `module-sync`, `default` (node).
"Fallback" means the chain moves on to `module`/`main`.

| `exports`                                                              | Subpath        | Core: browser / node | Node: browser / node |
| ---------------------------------------------------------------------- | -------------- | -------------------- | -------------------- |
| `"./main.js"`                                                          | `.`            | `main.js`            | same                 |
| `{ "./*": "./dist/*.js", "./internal/*": null }`                       | `./pub`        | `dist/pub.js`        | same                 |
| same                                                                   | `./internal/y` | not exported         | same                 |
| `{ "./a/*": "./x/*.js", "./a/*.js": "./y/*.js" }`                      | `./a/b.js`     | `y/b.js`             | same                 |
| `[null, "./ok.js"]`                                                    | `.`            | `ok.js`              | same                 |
| `{ "import": { "node": "./in.mjs", "browser": "./ib.mjs" } }`          | `.`            | `ib.mjs` / `in.mjs`  | same                 |
| `{ "import": { "node": "./in.mjs" }, "browser": "./b.js" }`            | `.`            | `b.js` / `in.mjs`    | same                 |
| `{ "browser": "./b.js", "default": null }`                             | `.`            | `b.js` / not exp.    | same                 |
| `{ "default": "./d.js", "import": "./e.mjs" }`                         | `.`            | `e.mjs`              | `d.js`               |
| `{ "node": "./n.js", "browser": "./b.js", "default": "./d.js" }`       | `.`            | `d.js`               | `b.js` / `n.js`      |
| `{ "react-native": "./rn.js", "browser": "./b.js", "node": "./n.js" }` | `.`            | `rn.js`              | `b.js` / `n.js`      |
| `{ ".": "./m.js" }`                                                    | `./other`      | fallback             | not exported         |
| `{ "types": "./t.d.ts" }`                                              | `.`            | fallback             | not exported         |

## Why

- The adapter bundles `entryPoint`, and the scan reads it. The app's own imports of the package are
  resolved by the bundler, which follows Node's algorithm. Where core reads `exports` differently,
  the shared bundle holds other code than the app imports, or a file the package does not export.
- Under an isolated install a dependency of a dependency is not installed at the workspace root.
  Looked up only from there, its imports were never scanned, and a shared package only it imports
  was pruned while the bundle still imported it.
- A shared package is bundled once from the workspace root and every importer loads that copy, so
  an importer's own install of it never runs. Scanning that install would keep what the running
  copy does not import and prune what it does.
- An install the importer sees, but that blocks the entry point, is still the one it loads. The
  workspace root's install is other code, so scanning it in its place would keep imports the
  running code does not have.
- Each platform has its own shared bundle, so each reads its own platform's file. The scan reads
  the same file the bundle will, so it keeps the imports that file really has.

## Rejected

- Taking the first key that matches, in the order the package lists them: a broad pattern listed
  before a narrower one, or `./*` before an exact key, points the entry point at another file than
  the bundler picks for the app's own import.
- Falling back to `module` or `main` for an entry point the package blocks: that file is one the
  package author kept private, and the app could not import it under that name either.
- Taking any condition key without regard to the platform: a browser bundle could hold the `node`
  build, and the scan would read imports the browser file does not have.

## Limits

### Differences from Node

Each line is a place where core deliberately does not do what Node does.

- **Condition order.** Core prefers an ESM key wherever it is listed, then `default`, then the
  first other key; Node takes the first listed key in its active set. The shared bundle is served
  as an ES module, and a package's ESM build needs no CommonJS interop
  (`src/lib/utils/package/cjs-named-exports.ts`). Core has no set of active conditions, only a
  platform (see the next line), so the rest of the order is kept as it was, and existing builds
  keep their entry file. Pinned by "prefers default over a platform key listed before it" in
  `exports-resolver.spec.ts`. Source: [conditional exports][node-conditions],
  `resolvePackageTarget` in [`resolve.js`][node-target].
- **Unknown conditions.** When no ESM key or `default` resolves, core takes the first key that is
  not `types` or the other platform, also one outside Node's active set (`react-native`, `worker`,
  or `require` for an import). The conditions follow from `platform` alone, and an adapter cannot
  add its own, so core cannot tell an active custom condition from an inactive one. Source:
  [community conditions][node-community].
- **Unlisted subpath.** A subpath the `exports` map has no key for, a `types`-only object, or a
  conditions object that resolves nothing falls back to `module`, `main` or a conventional file;
  Node throws `ERR_PACKAGE_PATH_NOT_EXPORTED` ([spec][node-algo] `PACKAGE_EXPORTS_RESOLVE` step 4).
  Steps 2 to 6 of the chain read packages without `exports` too, and blocking the fallback would
  drop entry points that builds share today. Only the four cases under
  [Target selection](#target-selection) block: a `null` target, an invalid target, an array where
  no element resolves, and a conditions object with `default: null` that resolves nothing.
- **No existence check.** Core never checks that the target file exists. Node does not either while
  resolving `exports`; it fails later, in `finalizeResolution` ([`resolve.js`][node-finalize]).
  In core a missing file fails when the adapter bundles it.
- **Backslashes.** A `\` in a valid target stays part of the file path: on POSIX `./a\b.js` names a
  file called `a\b.js`, where Node's URL parsing reads it as `a/b.js`. Core works with file paths,
  not URLs. A `\` still separates segments for the validity check, so `./a\..\..\x.js` is invalid,
  as in Node. Source: `invalidSegmentRegEx` in [`resolve.js`][node-target-string].
- **Percent-encoding.** Core does not decode targets, so `./%2e%2e/x.js` is a folder named `%2e%2e`
  inside the package, not `..`; Node rejects it as invalid. Undecoded, the path cannot leave the
  package, so the check has nothing to guard. Source: `invalidSegmentRegEx` in
  [`resolve.js`][node-target-string].
- **Malformed `exports`.** An object that mixes `.` keys with condition keys is read as a subpath
  map, and a numeric key as a condition name; Node throws `ERR_INVALID_PACKAGE_CONFIG` for both.
  The bundler reports such a package itself. Source: [spec][node-algo] `PACKAGE_EXPORTS_RESOLVE`
  step 1 and `isConditionalExportsMainSugar` in [`resolve.js`][node-sugar-impl] for mixed keys;
  `isArrayIndex` in `resolvePackageTarget` ([`resolve.js`][node-target]) for a numeric key.
- **Workspace-root fallback.** When the importer sees no install of a package that is not shared,
  the scan reads the one at the workspace root; Node looks only in the importer's own ancestors
  ([spec][node-algo] `PACKAGE_RESOLVE` step 10). A linked checkout outside the workspace can import
  a package it does not declare that the workspace installs, and the bundler, which resolves it
  through its own search paths, still finds it. For an importer inside the workspace the root is an
  ancestor, so the fallback reads nothing Node would not.
- **Shared packages ignore the importer.** A shared package is read from the workspace root, also
  when the importer has its own install, which Node would load. In the browser every importer gets
  the one shared bundle through the import map, whoever imports it ([HTML: import
  maps][html-import-maps]), and `bundleSharedCore` builds that bundle from the workspace root.

### Other limits

- The search over package roots ends at the first folder that gives an answer. A package that
  blocks an entry point in that folder hides a later folder whose package exports it. The
  production repository lists one folder, the workspace root or the folder of
  `fedOptions.packageJson`, and only when it holds a `package.json`.
- The scan does not follow a custom `packageJson` folder. `bundleSharedCore` looks up shared
  packages from the folder of `fedOptions.packageJson` when it is set, while the scan looks them up,
  and the packages workspace files import, from the workspace root. When the two folders see
  different installs, the scan reads another copy than the bundle holds.
- A shared package that is not installed at the workspace root, only below another package, is
  found by nothing: the scan, which looks it up from the root, skips it, and the shared bundle
  warns that it has no metadata for it.

Enforced by: `src/lib/utils/package/exports-resolver.spec.ts`,
`src/lib/utils/package/entry-point-resolver.spec.ts`, `src/lib/utils/package/package-info.spec.ts`,
`src/lib/config/get-used-dependencies.spec.ts`, `src/lib/core/build/bundle-shared.spec.ts`,
`src/lib/config/with-native-federation.spec.ts`
Issues: core#263, core#264
History: first matching key in listed order, no platform condition, `null` falling back to `main`
→ core#264 Node's key order and target rules, a condition per platform
Related: [Shared packages](shared-packages.md), [Published imports](published-imports.md)

[node-exports]: https://nodejs.org/api/packages.html#package-entry-points
[node-sugar]: https://nodejs.org/api/packages.html#exports-sugar
[node-subpath]: https://nodejs.org/api/packages.html#subpath-exports
[node-patterns]: https://nodejs.org/api/packages.html#subpath-patterns
[node-conditions]: https://nodejs.org/api/packages.html#conditional-exports
[node-community]: https://nodejs.org/api/packages.html#community-conditions-definitions
[node-algo]: https://nodejs.org/api/esm.html#resolution-algorithm-specification
[node-modules-lookup]: https://nodejs.org/api/modules.html#loading-from-node_modules-folders
[pnpm-symlinks]: https://pnpm.io/symlinked-node-modules-structure
[html-import-maps]: https://html.spec.whatwg.org/multipage/webappapis.html#import-maps
[node-finalize]: https://github.com/nodejs/node/blob/v24.16.0/lib/internal/modules/esm/resolve.js#L225
[node-finalize-realpath]: https://github.com/nodejs/node/blob/v24.16.0/lib/internal/modules/esm/resolve.js#L275-L288
[node-target-string]: https://github.com/nodejs/node/blob/v24.16.0/lib/internal/modules/esm/resolve.js#L357-L455
[node-target]: https://github.com/nodejs/node/blob/v24.16.0/lib/internal/modules/esm/resolve.js#L481-L547
[node-sugar-impl]: https://github.com/nodejs/node/blob/v24.16.0/lib/internal/modules/esm/resolve.js#L556-L577
[node-per]: https://github.com/nodejs/node/blob/v24.16.0/lib/internal/modules/esm/resolve.js#L588-L684
[node-package-resolve]: https://github.com/nodejs/node/blob/v24.16.0/lib/internal/modules/esm/resolve.js#L762-L786
