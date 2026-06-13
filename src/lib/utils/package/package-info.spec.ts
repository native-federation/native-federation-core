import { describe, expect, it } from 'vitest';
import * as path from 'path';
import { getPackageInfo, getVersionMaps, findDepPackageJson } from './package-info.js';
import { createPackageJsonRepository } from '../io/package-json-repository.js';
import { createMemoryIo } from '../io/__test-helpers__/memory-io.js';

const WS = path.resolve('/ws');

const seededRepo = () => {
  const io = createMemoryIo()
    .setFile(path.join(WS, 'package.json'), JSON.stringify({ dependencies: { react: '18.0.0' } }))
    .setFile(
      path.join(WS, 'node_modules/react/package.json'),
      JSON.stringify({ version: '18.0.0', module: './index.mjs' })
    );
  return createPackageJsonRepository(io);
};

describe('package-info facade (with injected repository)', () => {
  it('getPackageInfo resolves an installed dependency', () => {
    const info = getPackageInfo('react', WS, seededRepo());
    expect(info).toMatchObject({ packageName: 'react', version: '18.0.0', esm: true });
  });

  it('getVersionMaps reads the dependency versions', () => {
    expect(getVersionMaps(WS, WS, seededRepo())).toEqual([{ react: '18.0.0' }]);
  });

  it('findDepPackageJson locates the dependency package.json', () => {
    expect(findDepPackageJson('react', WS, seededRepo())).toBe(
      path.join(WS, 'node_modules/react/package.json')
    );
  });

  it('does not leak state across calls using independent repositories', () => {
    expect(getPackageInfo('react', WS, seededRepo())).not.toBeNull();
    // A fresh, empty repository must not see anything from the previous call.
    const empty = createPackageJsonRepository(createMemoryIo());
    expect(getPackageInfo('react', WS, empty)).toBeNull();
  });
});
