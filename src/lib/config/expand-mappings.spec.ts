import { afterEach, describe, expect, it, vi } from 'vitest';
import * as path from 'path';
import { expandWildcardMapping } from './expand-mappings.js';
import { matchMapping } from './match-mapping.js';
import { createMemoryIo } from '../utils/io/__test-helpers__/memory-io.js';
import { logger } from '../utils/logger.js';

const WS = path.resolve('/ws');
const abs = (p: string) => path.join(WS, p);

describe('expandWildcardMapping', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // The tsconfig shape where the wildcard stops at a directory. The expanded import names must
  // be the ones matchMapping derives ('@org/ui/button'), not the raw captured path
  // ('@org/ui/button/index.ts') — otherwise the import map advertises specifiers no remote
  // ever requests, which is silent breakage.
  it('names a bare-directory wildcard the way the reachability walk does', () => {
    const io = createMemoryIo()
      .setFile(abs('libs/ui/button/index.ts'), '')
      .setFile(abs('libs/ui/card/index.ts'), '');

    const mappedPath = abs('libs/ui/*');
    const result = expandWildcardMapping(mappedPath, '@org/ui/*', { io, workspaceRoot: WS });

    expect(result).toEqual({
      [abs('libs/ui/button/index.ts')]: '@org/ui/button',
      [abs('libs/ui/card/index.ts')]: '@org/ui/card',
    });

    for (const [file, importName] of Object.entries(result)) {
      expect(matchMapping(file, { [mappedPath]: '@org/ui/*' })).toBe(importName);
    }
  });

  it('strips the extension from a non-barrel module', () => {
    const io = createMemoryIo().setFile(abs('libs/ui/button.ts'), '');

    expect(expandWildcardMapping(abs('libs/ui/*'), '@org/ui/*', { io, workspaceRoot: WS })).toEqual(
      { [abs('libs/ui/button.ts')]: '@org/ui/button' }
    );
  });

  it('keeps the pattern suffix shape working', () => {
    const io = createMemoryIo().setFile(abs('libs/ui/button/src/index.ts'), '');

    expect(
      expandWildcardMapping(abs('libs/ui/*/src/index.ts'), '@org/ui/*', { io, workspaceRoot: WS })
    ).toEqual({ [abs('libs/ui/button/src/index.ts')]: '@org/ui/button' });
  });

  // '**' is a globstar only on a segment of its own, so a prefix that stops mid-segment has to
  // be widened back to its directory before globbing: 'libs/ui-**' reads as 'libs/ui-*' and
  // matches nothing a level down, which drops the mapping with a "matched no files" warning.
  it('expands a wildcard whose prefix stops mid-segment', () => {
    const io = createMemoryIo()
      .setFile(abs('libs/ui-button/src/index.ts'), '')
      .setFile(abs('libs/ui-card/src/index.ts'), '')
      .setFile(abs('libs/data-access/src/index.ts'), '');

    expect(
      expandWildcardMapping(abs('libs/ui-*/src/index.ts'), '@org/ui-*', { io, workspaceRoot: WS })
    ).toEqual({
      [abs('libs/ui-button/src/index.ts')]: '@org/ui-button',
      [abs('libs/ui-card/src/index.ts')]: '@org/ui-card',
    });
  });

  // The widened glob reaches further than the mapping does, so matchMapping still has to be
  // the thing that decides membership.
  it('ignores siblings the widened glob picks up but the prefix excludes', () => {
    const io = createMemoryIo()
      .setFile(abs('libs/ui-button/src/index.ts'), '')
      .setFile(abs('libs/other/nested/src/index.ts'), '');

    expect(
      expandWildcardMapping(abs('libs/ui-*/src/index.ts'), '@org/ui-*', { io, workspaceRoot: WS })
    ).toEqual({ [abs('libs/ui-button/src/index.ts')]: '@org/ui-button' });
  });

  // Installed packages are modules with barrel-shaped specifiers, so nothing downstream would
  // reject '@org/ui/node_modules/lodash' — the glob has to not see them in the first place.
  it('does not expand into nested node_modules', () => {
    const io = createMemoryIo()
      .setFile(abs('libs/ui/button/index.ts'), '')
      .setFile(abs('libs/ui/node_modules/lodash/index.js'), '');

    expect(expandWildcardMapping(abs('libs/ui/*'), '@org/ui/*', { io, workspaceRoot: WS })).toEqual(
      { [abs('libs/ui/button/index.ts')]: '@org/ui/button' }
    );
  });

  // A '**/*' glob sees the whole subtree, so everything that is not a module has to be dropped
  // — the reachability walk can only ever yield modules.
  it('skips files that are not modules', () => {
    const io = createMemoryIo()
      .setFile(abs('libs/ui/button/index.ts'), '')
      .setFile(abs('libs/ui/README.md'), '')
      .setFile(abs('libs/ui/theme.scss'), '')
      .setFile(abs('libs/ui/button/index.d.ts'), '');

    expect(expandWildcardMapping(abs('libs/ui/*'), '@org/ui/*', { io, workspaceRoot: WS })).toEqual(
      { [abs('libs/ui/button/index.ts')]: '@org/ui/button' }
    );
  });

  // A glob cannot tell a public entry point from an implementation file, so it only accepts
  // entry-point-shaped specifiers: a dot left after extension stripping means the latter.
  it('skips implementation files whose specifier keeps a dot', () => {
    const io = createMemoryIo()
      .setFile(abs('libs/ui/button/index.ts'), '')
      .setFile(abs('libs/ui/button/button.component.ts'), '')
      .setFile(abs('libs/ui/button/button.spec.ts'), '')
      .setFile(abs('libs/ui/card.service.ts'), '');

    expect(expandWildcardMapping(abs('libs/ui/*'), '@org/ui/*', { io, workspaceRoot: WS })).toEqual(
      { [abs('libs/ui/button/index.ts')]: '@org/ui/button' }
    );
  });

  it('warns when only implementation files matched', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const io = createMemoryIo().setFile(abs('libs/ui/button/button.component.ts'), '');

    const result = expandWildcardMapping(abs('libs/ui/*'), '@org/ui/*', { io, workspaceRoot: WS });

    expect(result).toEqual({});
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no entry points'));
  });

  it('keeps the first of two files resolving to the same import, and warns', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const io = createMemoryIo()
      .setFile(abs('libs/ui/button.ts'), '')
      .setFile(abs('libs/ui/button/index.ts'), '');

    const result = expandWildcardMapping(abs('libs/ui/*'), '@org/ui/*', { io, workspaceRoot: WS });

    expect(Object.values(result)).toEqual(['@org/ui/button']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('duplicate imports'));
  });

  it('warns when the mapped path holds no wildcard to expand', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    const result = expandWildcardMapping(abs('libs/ui/index.ts'), '@org/ui/*', {
      io: createMemoryIo(),
      workspaceRoot: WS,
    });

    expect(result).toEqual({});
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no wildcard'));
  });
});
