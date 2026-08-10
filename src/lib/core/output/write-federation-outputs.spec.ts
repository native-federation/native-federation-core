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

    writeFederationOutputs(federationInfo, options);

    expect(writeFederationInfo).toHaveBeenCalledWith(federationInfo, options);
  });

  // The dense shape has no import-map representation — @angular/core and its secondaries collapse
  // into one entry there — so the import map has to come from the flat cache, not from `shared`.
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

    writeFederationOutputs(federationInfo, options);

    expect(writeImportMap).toHaveBeenCalledWith(options.federationCache, options, undefined);
  });

  it('threads the integrity map through to the import map', () => {
    const options = fedOptions([]);
    const integrity = { 'core.js': 'sha384-abc' };

    writeFederationOutputs({ name: 'shell', shared: [], exposes: [], integrity }, options);

    expect(writeImportMap).toHaveBeenCalledWith(options.federationCache, options, integrity);
  });
});
