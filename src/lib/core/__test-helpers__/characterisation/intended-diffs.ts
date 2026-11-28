// Planned changes to what core shares and publishes, each named by an id and today's behaviour
// (`was`). The PR that makes a change updates the rows it touches and cites the id; any other change
// to a characterisation snapshot is a bug. Prunes less is fine when cited, prunes more never is.
// Code sites are named by file and symbol, which survive line drift.
export interface IntendedDiff {
  was: string;
  rows?: readonly string[];
}

export const INTENDED_DIFFS = {
  D1: {
    was: "'tslib/' never matches (default-skip-list.ts DEFAULT_SKIP_LIST); tslib is shareable",
    rows: ['C4'],
  },
  D2: {
    was: 'a raw literal defaults singleton/strictVersion to false (with-native-federation.ts normalizeShared)',
  },
  D3: {
    was: 'missing `shared` shares every dependency (with-native-federation.ts normalizeShared, fromPackageJson fallback); missing `sharedMappings` every mapping',
  },
  D4: {
    was: 'adapter `entryPoints` scanned only without exposes (get-used-dependencies.ts getUsedDependenciesFactoryCore)',
    rows: ['C9', 'C10'],
  },
  D5: {
    was: 'overrides bypass filter and skip (share-utils.ts shareAllCore)',
  },
  D6: {
    was: 'patches merge shallow; a patch on an overridden key is ignored (share-utils.ts applyPatches)',
  },
  D7: {
    was: 'secondaries of a package without `exports` crawled by readDir (secondaries.ts _findSecondaries)',
  },
  D8: {
    was: 'Node built-ins external only with `ignoreUnusedDeps: false` (default-external-list.ts sharedBundleExternals)',
    rows: ['R8'],
  },
  D9: {
    was: 'externals are the post-prune keys (get-externals.ts getExternals)',
  },
  D10: {
    was: 'a declared key missing from package.json throws at config time (version-lookup.ts lookupVersion)',
    rows: ['R7'],
  },
  D11: {
    was: '`{ range }` applies to the declared range (share-utils.ts shareAllCore and shareCore, publishedRequiredVersion); protocol values already fall back to the installed version',
    rows: ['C7'],
  },
  D12: {
    was: "`build` default `'default'` (one shared bundle)",
  },
  D13: {
    was: '`DEFAULT_SKIP_LIST`, a top-level `skip` and RegExp/function skip entries each drop matching keys (default-skip-list.ts, with-native-federation.ts)',
    rows: ['R6', 'C4'],
  },
  D14: {
    was: 'mapping config: first matching pattern wins (mapping-utils.ts resolveMappingConfig); npm-style name is the package',
  },
  D15: {
    was: "an exact `requiredVersion: '17.3.5'` is the required range as written; the record `version` is the installed one",
  },
  D16: {
    was: 'a written range is published whether or not the installed version satisfies it',
  },
  D17: {
    was: 'mapping `requiredVersion` is `~` on the library version, unfloored (mapping-record.ts mappingRequiredVersion)',
  },
  D18: {
    was: 'a hand-written `shared` key outside `dependencies` is shared as written',
  },
  D19: {
    was: "`features.mappingVersion` sets a mapping's `strictVersion` (mapping-utils.ts normalizeMappingConfig)",
  },
  D20: {
    was: 'two alias-file lookup orders, cwd first (project-paths.ts findMappingsTsConfigCore, findRootTsConfigCore; core#156)',
  },
  D21: {
    was: '`includeSecondaries: false` keeps secondaries out of `shared`; an imported one is bundled into its importer',
  },
  D22: {
    was: 'a non-npm mapping name warns, whatever `strictImports` says',
  },
  D23: {
    was: 'a user `version` is a fallback behind the installed version (share-utils.ts shareCore, shared-record.ts sharedPackageInfos); with `requiredVersion` set, that stays the range',
  },
  D24: {
    was: "a hand-written subpath key of a `dependencies` package (`'rxjs/operators'`, `share({ '@angular/common/http' })`) is shared as its own entry",
  },
  D25: {
    was: "conditions: an ESM key, else `default`, else the first key that is neither `types` nor the other platform's condition; the `browser` field is never read (exports-resolver.ts findOptimalExport)",
    rows: ['E7'],
  },
  D26: {
    was: 'a hand-written key without `requiredVersion` publishes the literal `"auto"` (with-native-federation.ts normalizeShared; with-native-federation.spec.ts "normalizes shared externals with sensible defaults")',
  },
  D27: {
    was: 'several `shareAll`/`fromPackageJson(...).get()` spreads in one `shared` union, the last spread winning per key',
  },
  D28: {
    was: 'entries of one package with different metadata split silently into records sharing a `packageName` (densify-externals.ts densifyExternals)',
  },
  D29: {
    was: 'preload without `features.denseChunking` warns that the runtime preloads only entry files (with-native-federation.ts warnPreloadWithoutDenseChunking)',
    rows: ['C8'],
  },
  D30: {
    was: 'preload in the combined shared bundle or a pool warns that every chunk of the bundle preloads (with-native-federation.ts warnPreloadInSharedBundle)',
    rows: ['C8'],
  },
} satisfies Record<string, IntendedDiff>;

export type IntendedDiffId = keyof typeof INTENDED_DIFFS;
