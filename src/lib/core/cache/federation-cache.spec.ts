import { describe, expect, it } from 'vitest';
import {
  addExternalsToCache,
  collectOutputFiles,
  createFederationCache,
  recordArtifactFiles,
  withStagedExternals,
} from './federation-cache.js';
import type { OutputFile, SharedInfo } from '../../domain/core/federation-info.contract.js';

const browser = (...fileNames: string[]): OutputFile[] =>
  fileNames.map(fileName => ({ fileName, platform: 'browser' }));

describe('addExternalsToCache', () => {
  it('keeps the written files of each bundle under its name', () => {
    const cache = createFederationCache('/cache');

    addExternalsToCache(cache, 'browser-shared', { externals: [], outputFiles: browser('a.js') });
    addExternalsToCache(cache, 'node-lib', {
      externals: [],
      outputFiles: [{ fileName: 'n.js', platform: 'node' }],
    });

    expect(cache.externalFiles).toEqual({
      'browser-shared': browser('a.js'),
      'node-lib': [{ fileName: 'n.js', platform: 'node' }],
    });
  });

  // A second run of the same bundle on one cache, e.g. an adapter calling buildForFederation
  // again with the same options, must not report its files twice.
  it('replaces the files of a bundle that runs again', () => {
    const cache = createFederationCache('/cache');

    addExternalsToCache(cache, 'browser-shared', { externals: [], outputFiles: browser('a.js') });
    addExternalsToCache(cache, 'browser-shared', { externals: [], outputFiles: browser('b.js') });

    expect(cache.externalFiles).toEqual({ 'browser-shared': browser('b.js') });
  });

  it('merges integrity across bundles', () => {
    const cache = createFederationCache('/cache');

    addExternalsToCache(cache, 'x', {
      externals: [],
      integrity: { 'a.js': 'h1' },
      outputFiles: [],
    });
    addExternalsToCache(cache, 'y', {
      externals: [],
      integrity: { 'b.js': 'h2' },
      outputFiles: [],
    });

    expect(cache.integrity).toEqual({ 'a.js': 'h1', 'b.js': 'h2' });
  });
});

describe('collectOutputFiles', () => {
  // Two separate bundles can emit a byte-identical helper chunk under one content-derived name;
  // both copies land on the same path in the flat output folder.
  it('lists a file that several bundles wrote once, as browser if any of them targets the browser', () => {
    const cache = createFederationCache('/cache');
    cache.externalFiles = {
      'node-a': [
        { fileName: 'a.js', platform: 'node' },
        { fileName: 'chunk-SAME.js', platform: 'node' },
      ],
      'browser-b': browser('b.js', 'chunk-SAME.js'),
      'node-c': [{ fileName: 'chunk-SAME.js', platform: 'node' }],
    };
    recordArtifactFiles(cache, { mappings: [], exposes: [], outputFiles: browser('Comp.js') });

    expect(collectOutputFiles(cache)).toEqual([
      { fileName: 'a.js', platform: 'node' },
      { fileName: 'chunk-SAME.js', platform: 'browser' },
      { fileName: 'b.js', platform: 'browser' },
      { fileName: 'Comp.js', platform: 'browser' },
    ]);
  });

  // Derived on every read: after a rebuild that fails between the shared bundles and the
  // mapping/exposed bundle, it pairs the newest shared files with the last artifact files.
  it('reflects external files replaced after the artifact files were recorded', () => {
    const cache = createFederationCache('/cache');
    cache.externalFiles = { shared: browser('a.old.js') };
    recordArtifactFiles(cache, { mappings: [], exposes: [], outputFiles: browser('Comp.js') });

    cache.externalFiles = { shared: browser('a.new.js') };

    expect(collectOutputFiles(cache)).toEqual(browser('a.new.js', 'Comp.js'));
  });

  it('accepts artifact info from before outputFiles existed', () => {
    const cache = createFederationCache('/cache');
    cache.externalFiles = { shared: browser('a.js') };
    recordArtifactFiles(cache, { mappings: [], exposes: [] });

    expect(collectOutputFiles(cache)).toEqual(browser('a.js'));
  });
});

// A run that throws halfway (an abort in watch mode) must not leave the cache holding only the
// bundles that finished: remoteEntry.json would lose the others until a full rebuild.
describe('withStagedExternals', () => {
  const external = (packageName: string) =>
    ({ packageName, outFileName: `${packageName}.js` }) as SharedInfo;
  const seeded = () => {
    const cache = createFederationCache('/cache');
    addExternalsToCache(cache, 'browser-shared', {
      externals: [external('old')],
      outputFiles: browser('old.js'),
    });
    return cache;
  };

  it('replaces the externals once the run completes', async () => {
    const cache = seeded();

    await withStagedExternals(cache, async staged => {
      addExternalsToCache(staged, 'browser-shared', {
        externals: [external('new')],
        outputFiles: browser('new.js'),
      });
    });

    expect(cache.externals).toEqual([external('new')]);
    expect(cache.externalFiles).toEqual({ 'browser-shared': browser('new.js') });
    expect(cache.sharedRunIncomplete).toBe(false);
  });

  it('keeps the last complete externals and marks the run incomplete when it throws', async () => {
    const cache = seeded();

    await expect(
      withStagedExternals(cache, async staged => {
        addExternalsToCache(staged, 'browser-shared', {
          externals: [external('new')],
          outputFiles: browser('new.js'),
        });
        throw new Error('aborted');
      })
    ).rejects.toThrow('aborted');

    expect(cache.externals).toEqual([external('old')]);
    expect(cache.externalFiles).toEqual({ 'browser-shared': browser('old.js') });
    expect(cache.sharedRunIncomplete).toBe(true);
  });

  // The staged copy starts from the cache, so any field it does not reset explicitly would carry
  // the previous run's chunks and hashes into the new set.
  it('starts a run from empty chunks, integrity and externalFiles', async () => {
    const cache = seeded();
    addExternalsToCache(cache, 'node-lib', {
      externals: [],
      chunks: { b: ['c-OLD.js'] },
      integrity: { 'c-OLD.js': 'sha384-OLD' },
      outputFiles: browser('c-OLD.js'),
    });

    await withStagedExternals(cache, async staged => {
      addExternalsToCache(staged, 'browser-shared', {
        externals: [external('new')],
        chunks: { 'browser-shared': ['c-NEW.js'] },
        integrity: { 'c-NEW.js': 'sha384-NEW' },
        outputFiles: browser('new.js', 'c-NEW.js'),
      });
    });

    expect(cache.chunks).toEqual({ 'browser-shared': ['c-NEW.js'] });
    expect(cache.integrity).toEqual({ 'c-NEW.js': 'sha384-NEW' });
    expect(cache.externalFiles).toEqual({ 'browser-shared': browser('new.js', 'c-NEW.js') });
  });

  it('does not add a retried run to the previous one', async () => {
    const cache = seeded();
    const run = async (staged: typeof cache) => {
      addExternalsToCache(staged, 'browser-shared', {
        externals: [external('new')],
        outputFiles: [],
      });
    };

    await withStagedExternals(cache, run);
    await withStagedExternals(cache, run);

    expect(cache.externals).toEqual([external('new')]);
  });
});
