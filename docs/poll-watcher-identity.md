# Poll watcher misses a rewrite within one clock tick

Status: fix in #182 (`fix/poll-watch-identity`, off `main`), reviewed 2026-10-19 and extended to
the replay dedupe (below); not merged yet.

## Problem

`pollWatch` (`src/lib/utils/io/node-io-adapter.ts`) is the fallback for linked shared packages,
where ng-packagr's atomic dist rewrites change the inode and defeat native `fs.watch`. It
snapshots each file's `mtimeMs` and reports a file whose mtime changed.

The kernel stamps mtime from a coarse clock (a few ms on ext4). A write and a second write inside
one tick get the same mtime, so the change is never reported:

- an atomic replace (write a temp file, rename it over the original) right after a save;
- a second save shortly after the first.

That is exactly the rewrite polling exists to catch. A linked library edited twice in quick
succession can leave the dev server on the first version until the next change.

## Evidence

- Probe on ext4 (this machine): 194 of 200 atomic rewrites in a row kept the same `mtimeMs`; the
  inode changed every time.
- Both `watch (poll)` specs in `node-io-adapter.spec.ts` are flaky because of it ("detects an
  atomic rewrite that changes the inode", "does not descend into the linked package own
  node_modules"): 14 of 20 runs failed. CI runs the suite on PRs against `main`, so this can fail
  unrelated PRs.

## Fix (#182)

Identify a file by inode, size and mtime together (`${ino}:${size}:${mtimeMs}`) instead of mtime
alone. After the change the spec passed 20 of 20 runs; the full suite passes, also on the
TypeScript floor. The same PR corrects AGENTS.md, which still said the tests are not in CI.

## Replay dedupe (added after review)

The dedupe in `file-watcher.ts` sits after the poll and dropped an event whose mtime and size were
unchanged once the mtime was older than `replayGraceMs`. A replace that keeps the size and restores
an old mtime (`cp -p`, `rsync -a`, tar) was therefore caught by the poll's inode check and then
dropped. Its identity now includes ctime, which such a replace always moves. The inode stays out of
the dedupe: on a mount with unstable inode numbers (CIFS `noserverino`) it changes on every stat and
would rebuild every poll interval.

## Known limit

An in-place save of the same length within one tick keeps inode, size and mtime, so it still goes
unseen. Catching it would need a content hash per poll, which is too costly for a linked checkout
with thousands of files.

## To do

- Review and merge #182 before the 4.9.0 stack (#180–#185) is retargeted to `main`, so the flaky
  specs do not fail those CI runs.
- Decide whether the known limit needs a follow-up issue.
