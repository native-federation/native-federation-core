import { describe, expect, it } from 'vitest';
import * as path from 'path';
import { getSecondaries } from './secondaries.js';
import { prepareSkipList } from './default-skip-list.js';
import { createMemoryIo } from '../utils/io/__test-helpers__/memory-io.js';
import type { ExternalConfig } from '../domain/config/external-config.contract.js';

const EMPTY_SKIP = prepareSkipList([]);
const shareObject: ExternalConfig = { singleton: true, requiredVersion: '^1.0.0' };

describe('getSecondaries', () => {
  const LIB = path.resolve('/root/node_modules/mylib');

  it('returns an empty map when the lib path does not exist', () => {
    expect(getSecondaries(createMemoryIo(), true, LIB, 'mylib', shareObject, EMPTY_SKIP)).toEqual(
      {}
    );
  });

  it('reads configured secondaries from the package.json exports map', () => {
    const io = createMemoryIo().setFile(
      path.join(LIB, 'package.json'),
      JSON.stringify({
        version: '1.2.3',
        type: 'module',
        exports: {
          '.': './index.js',
          './sub': { default: './sub/index.js' },
        },
      })
    );

    const result = getSecondaries(io, true, LIB, 'mylib', shareObject, EMPTY_SKIP);

    expect(Object.keys(result!)).toEqual(['mylib/sub']);
    expect(result!['mylib/sub']).toMatchObject({ singleton: true });
  });

  it('resolves a glob whose pattern has no JS extension and filters non-JS files', () => {
    const io = createMemoryIo()
      .setFile(
        path.join(LIB, 'package.json'),
        JSON.stringify({
          version: '1.2.3',
          type: 'module',
          exports: {
            '.': './index.js',
            './components/*': './components/*',
          },
        })
      )
      .setFile(path.join(LIB, 'components', 'button.js'), '')
      .setFile(path.join(LIB, 'components', 'icon.mjs'), '')
      .setFile(path.join(LIB, 'components', 'styles.css'), '')
      .setFile(path.join(LIB, 'components', 'logo.svg'), '');

    const result = getSecondaries(
      io,
      { skip: [], resolveGlob: true },
      LIB,
      'mylib',
      shareObject,
      EMPTY_SKIP
    );

    expect(Object.keys(result!).sort()).toEqual([
      'mylib/components/button.js',
      'mylib/components/icon.mjs',
    ]);
  });

  it('falls back to walking subfolders (readDir) when there is no exports map', () => {
    const io = createMemoryIo()
      .setFile(path.join(LIB, 'sub', 'package.json'), '{}')
      .setFile(path.join(LIB, 'node_modules', 'dep', 'package.json'), '{}');

    const result = getSecondaries(io, true, LIB, 'mylib', shareObject, EMPTY_SKIP);

    expect(Object.keys(result!)).toEqual(['mylib/sub']);
  });

  it('honours a custom skip list during the folder walk', () => {
    const io = createMemoryIo().setFile(path.join(LIB, 'sub', 'package.json'), '{}');

    const result = getSecondaries(
      io,
      { skip: ['mylib/sub'] },
      LIB,
      'mylib',
      shareObject,
      EMPTY_SKIP
    );

    expect(result).toEqual({});
  });
});
