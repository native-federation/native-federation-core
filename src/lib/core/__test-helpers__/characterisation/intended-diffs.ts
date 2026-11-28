// Every decided change to what core shares and publishes. A characterisation snapshot that changes
// cites one of these ids; any other change to it is a bug. Prunes less is fine when cited, prunes
// more never is. Code sites are named by file and symbol, which survive line drift.
export interface IntendedDiff {
  was: string;
  becomes: string;
  refs: readonly string[];
  owner: string;
}

export const INTENDED_DIFFS = {
  D1: {
    was: "'tslib/' never matches (default-skip-list.ts DEFAULT_SKIP_LIST); tslib is shareable",
    becomes: 'tslib shared when declared and reached',
    refs: ['A12', 'A11'],
    owner: 'sharing/04',
  },
  D2: {
    was: 'a raw literal defaults singleton/strictVersion to false (with-native-federation.ts normalizeShared)',
    becomes: 'one defaults table, both true',
    refs: ['A14'],
    owner: 'sharing/04',
  },
  D3: {
    was: 'missing `shared` shares every dependency (with-native-federation.ts normalizeShared, fromPackageJson fallback); missing `sharedMappings` every mapping',
    becomes: 'nothing shared, one info line',
    refs: ['A6'],
    owner: 'sharing/04, sharing/06',
  },
  D4: {
    was: 'adapter `entryPoints` scanned only without exposes (get-used-dependencies.ts getUsedDependenciesFactoryCore)',
    becomes: 'exposes ∪ `entryPoints`',
    refs: ['report.D6'],
    owner: 'sharing/02',
  },
  D5: {
    was: 'overrides bypass filter and skip (share-utils.ts shareAllCore)',
    becomes: 'override configures only; outside the selection warns and is dropped',
    refs: ['A7'],
    owner: 'sharing/04',
  },
  D6: {
    was: 'patches merge shallow; a patch on an overridden key is ignored (share-utils.ts applyPatches)',
    becomes: 'call order; `.override` replaces, `.patch` merges; only `secondaries` deep-merges',
    refs: ['A4'],
    owner: 'sharing/04',
  },
  D7: {
    was: 'secondaries of a package without `exports` crawled by readDir (secondaries.ts _findSecondaries)',
    becomes: "'.' plus exact paths, no crawl",
    refs: ['A5'],
    owner: 'sharing/02',
  },
  D8: {
    was: 'Node built-ins external only with `ignoreUnusedDeps: false` (default-external-list.ts sharedBundleExternals)',
    becomes: 'external in every browser bundle core plans, always',
    refs: ['m6'],
    owner: 'sharing/03',
  },
  D9: {
    was: 'externals are the post-prune keys (get-externals.ts getExternals)',
    becomes: 'declared names',
    refs: ['report.D4'],
    owner: 'sharing/03',
  },
  D10: {
    was: 'a declared key missing from package.json throws at config time (version-lookup.ts lookupVersion)',
    becomes: 'only reached keys need an install',
    refs: ['report.D7'],
    owner: 'sharing/04',
  },
  D11: {
    was: '`{ range }` applies to the declared range (share-utils.ts shareAllCore and shareCore, publishedRequiredVersion); protocol values already fall back to the installed version',
    becomes: '`range` on the installed version, `floor`',
    refs: ['A8', 'A9'],
    owner: 'sharing/05',
  },
  D12: {
    was: "`build` default `'default'` (one shared bundle)",
    becomes: "`'package'`",
    refs: ['A17'],
    owner: 'sharing/07',
  },
  D13: {
    was: '`DEFAULT_SKIP_LIST`, top-level `skip`, RegExp/function entries',
    becomes:
      "top-level `skip` removed; a RegExp/function entry throws unless `===` a `DEFAULT_SKIP_LIST` member (dropped); the federation runtime packages are never shared; `DEFAULT_SKIP_LIST`'s own role is open",
    refs: ['A11'],
    owner: 'sharing/04',
  },
  D14: {
    was: 'mapping config: first matching pattern wins (mapping-utils.ts resolveMappingConfig); npm-style name is the package',
    becomes: 'call order; every `paths` entry its own package unless `.package()` groups it',
    refs: ['A2', 'A4'],
    owner: 'sharing/06',
  },
  D15: {
    was: "an exact `requiredVersion: '17.3.5'` is the required range as written; the record `version` is the installed one",
    becomes: 'a pin: record `version` `17.3.5`, `requiredVersion` `~17.3.0`',
    refs: ['A8', 'L5'],
    owner: 'sharing/05',
  },
  D16: {
    was: 'a written range is published whether or not the installed version satisfies it',
    becomes: 'a build error naming the key',
    refs: ['A8', 'L5'],
    owner: 'sharing/05',
  },
  D17: {
    was: 'mapping `requiredVersion` is `~` on the library version, unfloored (mapping-record.ts mappingRequiredVersion)',
    becomes: 'floored: `1.2.3` → `~1.2.0`',
    refs: ['A9', 'L5'],
    owner: 'sharing/05',
  },
  D18: {
    was: 'a hand-written `shared` key outside `dependencies` is shared as written',
    becomes:
      'an error: "add it to `dependencies`"; a key with `packageInfo` is `custom` (exempt until sharing/04 (c))',
    refs: ['report.D5r'],
    owner: 'sharing/04 (a)',
  },
  D19: {
    was: "`features.mappingVersion` sets a mapping's `strictVersion` (mapping-utils.ts normalizeMappingConfig)",
    becomes:
      'flag gone: a versioned mapping takes `strictVersion` from the defaults table, a versionless one is written without it; `mappingVersion: false` throws',
    refs: ['A14'],
    owner: 'sharing/06',
  },
  D20: {
    was: 'two alias-file lookup orders, cwd first (project-paths.ts findMappingsTsConfigCore, findRootTsConfigCore; core#156)',
    becomes: 'one order, `workspaceRoot` before cwd',
    refs: ['smell #11'],
    owner: 'contract/03 PR b1',
  },
  D21: {
    was: '`includeSecondaries: false` keeps secondaries out of `shared`; an imported one is bundled into its importer',
    becomes:
      "reached secondaries are published (shares more); `secondaries: { exclude: ['*'] }` forbids them, and an imported one fails strict with reason `'excluded'`",
    refs: ['P12'],
    owner: 'sharing/04 (b)',
  },
  D22: {
    was: 'a non-npm mapping name warns, whatever `strictImports` says',
    becomes:
      'an error, independent of `strictImports`, only for names that break (URL-reserved or file-name-invalid characters, case-only collisions, an empty, `.` or `..` segment); every other name is accepted',
    refs: ['P5'],
    owner: 'sharing/06',
  },
  D23: {
    was: 'a user `version` is a fallback behind the installed version (share-utils.ts shareCore, shared-record.ts sharedPackageInfos); with `requiredVersion` set, that stays the range',
    becomes: '`version` is a pin; the range follows the range table; with both set, `version` wins',
    refs: ['A8', 'L5'],
    owner: 'sharing/05',
  },
  D24: {
    was: "a hand-written subpath key of a `dependencies` package (`'rxjs/operators'`, `share({ '@angular/common/http' })`) is shared as its own entry",
    becomes:
      "an error from sharing/04 (b): remove it or `.patch(['x'], { secondaries: { include: ['y'] } })`",
    refs: ['A5', 'report.D5r'],
    owner: 'sharing/04 (b)',
  },
  D25: {
    was: "conditions: an ESM key, else `default`, else the first key that is neither `types` nor the other platform's condition; the `browser` field is never read (exports-resolver.ts findOptimalExport)",
    becomes:
      'a conditions object read in its own key order against a platform condition set; on browser, a string `browser` field before `module`/`main`',
    refs: ['M12'],
    owner: 'sharing/02',
  },
  D26: {
    was: 'a hand-written key without `requiredVersion` publishes the literal `"auto"` (with-native-federation.ts normalizeShared; with-native-federation.spec.ts "normalizes shared externals with sensible defaults")',
    becomes: 'resolved like every other form, through the one defaults table',
    refs: ['A13', 'A14', 'L5'],
    owner: 'sharing/05',
  },
  D27: {
    was: 'several `shareAll`/`fromPackageJson(...).get()` spreads in one `shared` union, the last spread winning per key',
    becomes:
      "two recipes in `shared` throw, naming `fromPackageJson(cfg, [paths])` with the app's folder first; that form gives the same union, the first path winning",
    refs: ['W17'],
    owner: 'sharing/04 (a)',
  },
  D28: {
    was: 'entries of one package with different metadata split silently into records sharing a `packageName` (densify-externals.ts densifyExternals)',
    becomes:
      "one record per package with the main entry's config, else its first declared entry's (`requiredVersion`, `singleton`, `strictVersion`, `version`, `pool`, `chunks`, `build`, `shareScope`, `preload`; `platform` is not a package setting), plus one warning naming the package and the ignored fields, never a throw; a version read from package.json is aligned silently",
    refs: ['W15'],
    owner: 'contract/07',
  },
  D29: {
    was: 'preload without `features.denseChunking` warns that the runtime preloads only entry files (with-native-federation.ts warnPreloadWithoutDenseChunking)',
    becomes: 'no warning: the dense flags are removed and remoteEntry.json always lists chunks',
    refs: ['W1', 'W2', 'W5'],
    owner: 'contract/07 PR a',
  },
  D30: {
    was: 'preload in the combined shared bundle or a pool warns that every chunk of the bundle preloads (with-native-federation.ts warnPreloadInSharedBundle)',
    becomes: "no warning: each record lists its own chunks, and preload fetches only the record's",
    refs: ['W2', 'W14'],
    owner: 'contract/07 PR b',
  },
} satisfies Record<string, IntendedDiff>;

export type IntendedDiffId = keyof typeof INTENDED_DIFFS;
