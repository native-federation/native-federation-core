import { describe, expect, it, vi } from 'vitest';
import type { FederationInfo, SharedInfo } from '../../domain/core/federation-info.contract.js';
import type { NormalizedFederationOptions } from '../../domain/core/federation-options.contract.js';

vi.mock('./write-federation-info.js', () => ({ writeFederationInfo: vi.fn() }));
vi.mock('./write-import-map.js', () => ({ writeImportMap: vi.fn() }));

const { writeFederationOutputs } = await import('./write-federation-outputs.js');
const { writeFederationInfo } = await import('./write-federation-info.js');
const { writeImportMap } = await import('./write-import-map.js');

const flat = (packageName: string, outFileName: string): SharedInfo =>
  ({ packageName, outFileName }) as SharedInfo;

const fedOptions = (externals: SharedInfo[]): NormalizedFederationOptions =>
  ({
    workspaceRoot: '/ws',
    outputPath: 'dist',
    federationCache: { externals, cachePath: '/cache', bundlerCache: undefined },
  }) as NormalizedFederationOptions;

describe('writeFederationOutputs', () => {
  it('hands the federation info to writeFederationInfo', () => {
    const federationInfo: FederationInfo = { name: 'shell', shared: [], exposes: [] };
    const options = fedOptions([]);

    writeFederationOutputs(federationInfo, options, { mappings: [] });

    expect(writeFederationInfo).toHaveBeenCalledWith(federationInfo, options);
  });

  // The dense shape has no import-map representation — @angular/core and its secondaries collapse
  // into one entry there — so the import map has to come from the flat lists, not from `shared`.
  it('builds the import map from the flat cache, not from the assembled shared array', () => {
    const externals = [
      flat('@angular/core', 'core.js'),
      flat('@angular/core/rxjs-interop', 'ri.js'),
    ];
    const options = fedOptions(externals);
    const federationInfo: FederationInfo = {
      name: 'shell',
      shared: [{ packageName: '@angular/core', entries: { '@angular/core': 'core.js' } }],
      exposes: [],
    } as unknown as FederationInfo;

    writeFederationOutputs(federationInfo, options, { mappings: [] });

    expect(writeImportMap).toHaveBeenCalledWith(
      { externals, chunks: undefined },
      options,
      undefined
    );
  });

  // core#248: an exposed bundle importing a shared mapping must resolve it through the static
  // importmap.json, not only through the runtime's map built from remoteEntry.json.
  it('includes shared mappings next to the cached externals', () => {
    const external = flat('@angular/core', 'core.js');
    const mapping = flat('@internal/logging', '_internal_logging-3DJSPYNN.js');
    const options = fedOptions([external]);

    writeFederationOutputs({ name: 'mfe1', shared: [], exposes: [] }, options, {
      mappings: [mapping],
    });

    expect(writeImportMap).toHaveBeenCalledWith(
      { externals: [external, mapping], chunks: undefined },
      options,
      undefined
    );
  });

  // core#248: an exposed bundle imports its chunks as `@nf-internal/...`. Those live in the
  // artifact's chunks, which only the assembled federation info merges with the cache's.
  it('takes the chunks from the federation info, exposed and mapping bundles included', () => {
    const options = fedOptions([]);
    const chunks = {
      'browser-angular_core': ['chunk-YSTJXBMP.js'],
      'mapping-or-exposed': ['chunk-NUORN2G7.js'],
    };

    writeFederationOutputs({ name: 'mfe3', shared: [], exposes: [], chunks }, options, {
      mappings: [],
    });

    expect(writeImportMap).toHaveBeenCalledWith({ externals: [], chunks }, options, undefined);
  });

  it('threads the integrity map through to the import map', () => {
    const options = fedOptions([]);
    const integrity = { 'core.js': 'sha384-abc' };

    writeFederationOutputs({ name: 'shell', shared: [], exposes: [], integrity }, options, {
      mappings: [],
    });

    expect(writeImportMap).toHaveBeenCalledWith(
      { externals: [], chunks: undefined },
      options,
      integrity
    );
  });
});
