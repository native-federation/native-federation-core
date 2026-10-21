import { describe, expect, it } from 'vitest';
import {
  addExternalsToCache,
  collectOutputFiles,
  createFederationCache,
  recordArtifactFiles,
} from './federation-cache.js';
import type { OutputFile } from '../../domain/core/federation-info.contract.js';

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

  // Derived on every read, so the list cannot go stale when a rebuild fails between the shared
  // bundles and the mapping/exposed bundle.
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
