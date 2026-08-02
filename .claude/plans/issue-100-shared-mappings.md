# Issue #100 — per-mapping `ExternalConfig` for `sharedMappings`

Branch: `issues/100`. Design agreed in https://github.com/native-federation/native-federation-core/issues/100#issuecomment-5156075358

## Loop protocol

One iteration = one unchecked step, nothing more.

1. Read this file. Pick the **first** unchecked `[ ]` step.
2. Do only that step. Do not start the next one, even if it looks trivial.
3. Run the gate: `pnpm typecheck && pnpm test && pnpm lint`, then `npx prettier --write` the touched files.
   `pnpm typecheck` uses `tsconfig.build.json`, which **excludes specs** — so also run
   `npx tsc -p tsconfig.spec.json --noEmit` and check the error count is still 15. That config has
   15 pre-existing errors and is not in CI; the bar is "added none", not "clean".
4. Gate green → tick the box, append a line to **Log** (what changed, anything surprising). Gate red → fix within this step's scope; if that fails twice, mark the step `[!]`, write why in **Log**, and stop.
5. Stop. Do not commit unless the step says so.

Exit: every box `[x]` → stop the loop. Any box `[!]` → stop the loop and surface it.

Invariant: every step leaves the tree green, so any iteration can be the last one.

Nothing gets posted to GitHub from inside the loop.

## Current state

**All 13 steps complete.** Full CI-equivalent gate green: typecheck, build, lint (0 errors),
knip, 344 tests, spec-typecheck still at its 15-error baseline.

Committed: 1.1-1.2 as `a383879`. Everything from 1.3 onward is **uncommitted** in the working
tree — 14 modified files plus 3 new (`config/mapping-utils.ts`, `config/mapping-utils.spec.ts`,
`config/expand-mappings.ts`). Nothing has been posted to the issue.

## Design invariants

Hold these across every step; if one has to give, stop and flag it.

- `PathToImport` (`Record<absPath, importName>`) and `NFBuildAdapterOptions.mappedPaths` do not change shape. They are public via `src/internal/browser.ts:8`; changing them breaks every bundler adapter.
- Config travels in a **sibling** field on `NormalizedFederationConfig`, keyed by the user's selection pattern — not by resolved import, which wildcard substitution rewrites.
- Multiple matching patterns → **first match wins** (same rule as `matchMapping`, `get-used-dependencies.ts:158`).
- Omitted fields keep today's behavior exactly: `singleton: true`, `strictVersion: features.mappingVersion`, version from the mapped lib's nearest `package.json`.
- Out of scope: `build`, `platform`, `chunks`, `packageInfo` on mappings.

## Phase 1 — input shape and builder (no behavior change)

- [x] **1.1 Wildcard-matched selection.** In `getRawMappedPathsCore` (`mapped-paths.ts:45`) replace `sharedMappings.includes(key)` with `matchesWildcard(key, pattern)` from `utils/path-patterns.js`. Exact strings must behave identically (`matchesWildcard` falls back to `===` with no `*`).
  *Done when:* `mapped-paths.spec.ts` has a case proving `['@org/*']` selects `@org/ui` and `@org/auth`, and the existing exact-match cases still pass untouched.

- [x] **1.2 Accept tuple entries.** Widen `getRawMappedPathsCore` to `Array<string | [string[], ExternalConfig]>`; flatten to ordered `(pattern, config)` pairs; return `{ paths: PathToImport, configs: Record<pattern, ExternalConfig> }`. Update the caller at `with-native-federation.ts:115` and the arg assertion at `with-native-federation.spec.ts:193`.
  *Done when:* typecheck passes for the first time; a mixed array (`['@org/a', [['@org/b'], {singleton:false}]]`) is covered by a spec.

- [x] **1.3 `mappingsFromWorkspace` builder.** New file beside `share-utils.ts`, mirroring the `fromPackageJson` builder shape (`share-utils.ts:25`). `.filter(patterns)`, `.patch(patterns, cfg)`, `.get()` → the array form from 1.2. No filter → `[[['*'], base]]`. `.patch` pre-merges over the base and emits most-specific-first. Export from `src/config.ts`.
  *Done when:* the three equivalences in the issue comment's table are asserted as unit tests.

## Phase 2 — carry config through normalization

- [x] **2.1 Side-table on the normalized config.** Add `sharedMappingsConfig: Record<pattern, NormalizedExternalConfig>` to `NormalizedFederationConfig`; populate in `with-native-federation.ts`, defaulting each field per the invariants above.
  *Decision to make in this step:* required field (consistent with `features`, but touches the `NormalizedFederationConfig` literals in `remove-unused-deps.spec`, `normalize-options.spec`, `build-for-federation.spec`, `bundle-shared.spec`, `bundle-exposed-and-mappings.spec`, `get-used-dependencies.spec`) vs. optional (smaller diff, weaker guarantee). Record the choice in **Log**.
  *Done when:* a config with no `sharedMappings` still normalizes to exactly today's output.

- [x] **2.2 Resolution helper.** `resolveMappingConfig(importName, table)` — ordered `matchesWildcard`, first match wins, undefined when nothing matches.
  *Done when:* unit tests cover exact-beats-wildcard ordering, `'*'` catch-all, and no-match.

## Phase 3 — honor the metadata in `remoteEntry.json`

- [x] **3.1 Apply overrides in `toSharedMappingInfo`** (`bundle-exposed-and-mappings.ts:206`): `singleton`, `strictVersion`, `requiredVersion`, `version`, `shareScope`, `pool`. Everything omitted falls through to the current hardcoded defaults.
  *Done when:* `bundle-exposed-and-mappings.spec.ts` asserts both an overridden mapping and an un-annotated one emitting today's exact `SharedInfo`.

## Phase 4 — `keepAll` (this is what actually closes the issue)

- [x] **4.1 Literal keys.** `remove-unused-deps.ts:15` currently replaces `sharedMappings` wholesale with the reachability result. Union back the raw entries whose resolved config has truthy `includeSecondaries` (or `.keepAll`), for non-wildcard patterns only. Wildcards are step 4.2 — until then, warn and skip them.
  *Done when:* a spec shows a `keepAll` mapping surviving a reachability walk that doesn't reach it.

- [x] **4.2 Wildcard expansion.** For `keepAll` + `resolveGlob`, expand the pattern on disk instead of relying on the walk. `resolvePackageJsonExportsWildcardCore` (`utils/package/resolve-wildcard-keys.ts`) already does prefix/`**/*`/suffix globbing and should fit nearly verbatim; it needs a `GlobPort`, so thread `io` into `removeUnusedDeps` from `normalize-options.ts:99` (deps are already in scope there).
  *Done when:* a memory-io spec expands `@org/ui/*` into concrete entries with no reachability input at all.

- [x] **4.3 Revisit the `ignoreUnusedDeps: false` drop.** `normalize-options.ts:105-113` discards wildcard mappings with a warning because nothing else can expand them. With 4.2 available, either expand them there too or narrow the warning to the un-expandable case.
  *Done when:* the warning no longer fires for a mapping that 4.2 can expand.

## Phase 5 — docs and close-out

- [x] **5.1 README.** Extend "Determining which internal libraries are shared" (~line 418) with the tuple form, the builder, and the `keepAll`/`resolveGlob` pair. State plainly that `build`/`platform`/`chunks`/`packageInfo` are not honored on mappings.

- [x] **5.2 `AGENTS.md:112`.** `sharedMappings: ['@my-org/*']` is currently misleading — exact-match means it only works if that literal string is a tsconfig key. True as of 1.1; verify and adjust the comment.

- [x] **5.3 Close-out.** `pnpm typecheck && pnpm test && pnpm lint && pnpm knip`. Summarize the diff against the plan (anything skipped, anything added). Draft an issue reply but **do not post it** — leave it in **Log** for review.

## Log

<!-- one line per completed step: date, step, what changed, surprises -->

- 2026-08-02 — **1.1** `mapped-paths.ts:46` now selects via `matchesWildcard(key, pattern)` instead of `includes`. 3 specs added (wildcard pattern selects many keys; a pattern matches a wildcard tsconfig key verbatim; an exact pattern does *not* match a wildcard key). 313 tests green, lint clean (5 pre-existing `no-console` warnings in `logger.ts`). Typecheck still fails only on the known `with-native-federation.ts:115` error — step 1.2 closes it. Note: `pnpm lint` does not run Prettier, so format explicitly (`npx prettier --write`) before calling a step done.
- 2026-08-02 — **1.2** Added `SharedMappingEntry` / `SharedMappingConfigs` to `federation-config.contract.ts` and narrowed `sharedMappings` to `Array<SharedMappingEntry>`. `getRawMappedPathsCore` now flattens entries via `flattenEntries` and returns `{ paths, configs }` (`RawMappedPaths`); caller destructures `{ paths }`, so configs are collected but not yet consumed — that lands in 2.1. Repeated pattern → first declaration wins, matching the downstream resolution rule. Specs: 3 new in `mapped-paths.spec.ts`, mock shape updated in `with-native-federation.spec.ts`. **Typecheck clean for the first time**, 316 tests, 0 lint errors. Committed as `a383879` (plan file left untracked).
- 2026-08-02 — **1.3** New `mapping-utils.ts` with `mappingsFromWorkspace(base?)` → `.filter()` / `.patch()` / `.get()`, exported from `src/config.ts`. All three issue-comment equivalences asserted, plus repeated-`filter()` union and patch declaration order. **Decision:** `patch()` annotates but never widens (see next entry for the 2.1 decisions) — a patch pattern not covered by `filter()` is dropped with a `logger.warn`, so `.get()` can't smuggle an unselected key into the selection. Base config defaults to `{}`. 324 tests, knip clean.
- 2026-08-02 — **2.1** Added `sharedMappingsConfig: NormalizedSharedMappingConfigs` (**required**, decision below) to `NormalizedFederationConfig`, populated by a new `normalizeMappingConfigs` in `with-native-federation.ts`; `withNativeFederation` now calls `getRawMappedPaths` once and feeds both fields, so `removeSkippedMappings` takes `paths` instead of the whole config. **Decision 1:** required field — each of the 5 fixtures is a single factory, so it cost one line each. **Decision 2:** new `NormalizedMappingConfig` type rather than reusing `NormalizedExternalConfig`, which would have forced invented values for the out-of-scope `build`/`platform`/`chunks`/`packageInfo`; `requiredVersion`/`version` stay optional because their defaults are read from package.json at build time (3.1). **Gotcha found:** `pnpm typecheck` excludes specs — see the gate note above. 327 tests.
- 2026-08-02 — **2.2** `resolveMappingConfig(importName, configs)` added to `mapping-utils.ts`: iterates the table in insertion order and returns the first `matchesWildcard` hit, else undefined. Key case covered: a *resolved* import (`@org/ui/button`) matches the pattern it came from (`@org/ui/*`). **Clarification:** the done-when said "exact beats wildcard", but the real rule is purely declaration order — an exact pattern only wins if declared first. Both directions are now asserted so the semantics can't drift; the builder depends on this by emitting patches ahead of the catch-all. 333 tests.
- 2026-08-02 — **3.1** `toSharedMappingInfo` now resolves a mapping's config and applies `singleton` / `strictVersion` / `version` / `requiredVersion` / `shareScope` / `pool`; `describeSharedMappings` (the dev-server path) gets it for free since it shares the helper. **Decision:** an explicit `version` also drives `requiredVersion` (`version: '2.1.0'` → `~2.1.0`), mirroring how the detected version does it; an explicit `requiredVersion` still wins outright. Specs cover the un-annotated baseline emitting today's exact `SharedInfo`, a full override, requiredVersion precedence, and a resolved import matching its wildcard pattern. 337 tests, knip clean. **Phase 3 done — metadata now reaches remoteEntry.json.**
- 2026-08-02 — **4.1** `removeUnusedDeps` merges `{ ...keptMappings(config), ...usedDependencies.internal }` instead of replacing outright; `keptMappings` walks the raw (pre-prune) mappings and keeps any whose resolved config has truthy `includeSecondaries`. **Decision:** truthy `includeSecondaries` is the opt-out, mirroring the `shared` side exactly (`includeSecondaries: true` and `{keepAll:true}` both work) rather than reading `.keepAll` specifically — that's the behaviour issue #100 pointed at. Wildcard entries are detected on the *raw mapping* (path or import containing `*`), not on the config pattern, since it's the mapping that has to be a buildable entry point; those warn and prune until 4.2. 341 tests. **This closes the issue for literal keys.**
- 2026-08-02 — **4.2** Wildcard mappings with `resolveGlob` are now expanded on disk. `removeUnusedDeps` takes a third `MappingExpansionContext { io: GlobPort, workspaceRoot }`, threaded from `normalize-options.ts` (its `deps.io` type widened to `FileReaderPort & GlobPort`; `nodeIo` and the memory io already satisfy it). `resolvePackageJsonExportsWildcardCore` was reused verbatim — the mapping path is made workspace-relative first, then results are re-absolutised. **Decision:** expansion requires `resolveGlob` explicitly; `keepAll` alone on a wildcard still warns and prunes, so the flag pair reads exactly as designed (`keepAll` = don't prune, `resolveGlob` = expand the `*`). Also warns when a pattern matches nothing on disk, so a typo'd path isn't silently dropped. 343 tests, knip clean. **Phase 4 functionally done bar the 4.3 warning cleanup.**
- 2026-08-02 — **4.3** Extracted the expansion helpers into `config/expand-mappings.ts` (`isWildcardMapping`, `resolvesGlob`, `expandWildcardMapping`, `expandOrDropWildcards`, `MappingExpansionContext`) so both pruning paths share them. `normalize-options.ts` now calls `expandOrDropWildcards` instead of blanket-dropping: a `resolveGlob` wildcard is expanded and no longer warns; the rest still drop, but the warning now names which imports were dropped and how to fix it. **Phase 4 complete — only docs remain.** 344 tests. Two lint notes: the `no-irregular-whitespace` rule catches a zero-width space if you use one to escape `*/` inside a JSDoc, and `pnpm lint` exits non-zero on errors but not on the 5 pre-existing warnings.
- 2026-08-02 — **5.1** README: added "Configuring shared mappings" (tuple form, first-match-wins, the honoured property list, and an explicit note that `build`/`platform`/`chunks`/`packageInfo` are not) and "Keeping mappings that nothing imports" (`keepAll` + `resolveGlob`, with the wildcard reason spelled out), plus a bullet that selection entries are pattern-matched. Closed with the architectural caveat from the issue reply. Examples use ESM imports to match the rest of the file. **Note:** README is Prettier-formatted and was clean at baseline — run `npx prettier --write README.md`, `pnpm lint` does not cover it.
- 2026-08-02 — **5.2** Verified `sharedMappings: ['@my-org/*']` in `AGENTS.md` is now genuinely true (covered by the `mapped-paths.spec.ts` pattern test from 1.1); reworded the inline comment to state the pattern semantics and the share-all default, and added a `sharedMappings` bullet to "Important Configuration Options" covering the tuple form, `mappingsFromWorkspace`, the `keepAll`/`resolveGlob` pair, and the unsupported properties.
- 2026-08-02 — **5.3** Close-out. Full CI gate green (typecheck, build, lint 0 errors, knip, 344 tests, spec-typecheck at baseline 15). Plan executed as written — no steps skipped, nothing added beyond scope. Two things landed slightly differently than planned, both logged above: 4.2's expansion helpers were extracted into `config/expand-mappings.ts` during 4.3 so both pruning paths could share them (the plan had 4.2 keeping them local), and 2.1 introduced a dedicated `NormalizedMappingConfig` instead of reusing `NormalizedExternalConfig`. Drafted issue reply below — **not posted**.

## Post-review fixes

- 2026-08-02 — **skip bypass.** `skip` was only ever applied to raw mapping patterns, so wildcard-expanded imports (`@org/ui/internal`) escaped it — pre-existing on the reachability path, widened by `resolveGlob`. Fixed at the merge point: `removeUnusedDeps` now filters the combined result through a shared `withoutSkippedMappings`, and `expandOrDropWildcards` filters its output too. `with-native-federation.ts`'s private `removeSkippedMappings` was replaced by the same helper. Covers both the glob and reachability paths.
- 2026-08-02 — **`includeSecondaries: true` is now a no-op for mappings.** A mapped path has no secondary entry points, so only `{ keepAll: true }` opts out of pruning. New `keepsAll()` sits beside `resolvesGlob()` in `expand-mappings.ts`. README and AGENTS.md updated. 347 tests.
- **Not done (agreed):** shadowed-entry warning for hand-written arrays (edge case, builder can't produce it); `/internal` export + cache-hash churn review.

## Drafted issue reply (NOT posted)

> Implemented on `issues/100`. `sharedMappings` now takes `Array<string | [string[], ExternalConfig]>`, with a `mappingsFromWorkspace()` builder that produces the same array form.
>
> For your shell, the whole workaround collapses to:
>
> ```js
> sharedMappings: mappingsFromWorkspace({
>   includeSecondaries: { keepAll: true, resolveGlob: true },
> }).get()
> ```
>
> No filter, no enumerating 50 libs, and the synthetic-exposes file can go.
>
> How it resolves: selection entries are wildcard-matched (so `'@my-org/*'` selects every mapped path under the scope, which the docs previously implied but didn't do), and where several entries match the same mapping the first one wins. `keepAll` exempts a mapping from `ignoreUnusedDeps` pruning exactly as it does for `shared` packages. Wildcards additionally need `resolveGlob`, because a wildcard mapping is a pattern rather than an entry point — previously only the reachability scan could turn it into concrete files, and `resolveGlob` expands it against the filesystem instead. Without it a wildcard opting out is dropped with a warning that says so.
>
> Per-mapping metadata now reaching `remoteEntry.json`: `singleton`, `strictVersion`, `requiredVersion`, `version`, `shareScope`, `pool`. `build`, `platform`, `chunks` and `packageInfo` are not honoured — mappings all share the single `mapping-or-exposed` bundle, so there is nothing for them to select. That's documented rather than silently ignored.
>
> Defaults are unchanged, so existing configs emit byte-identical output.
>
> The architectural caveat from earlier still stands and is now in the README too: a host supplying its remotes' libraries couples them, and the remote can no longer run standalone. The escape hatch exists because `shared` has always had one, not because it's the shape I'd recommend first.
