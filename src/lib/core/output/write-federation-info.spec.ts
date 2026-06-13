import { describe, expect, it } from 'vitest';
import { writeFederationInfoCore } from './write-federation-info.js';
import { createMemoryIo } from '../../utils/io/__test-helpers__/memory-io.js';
import type { FederationInfo } from '../../domain/core/federation-info.contract.js';
import type { FederationOptions } from '../../domain/core/federation-options.contract.js';

const info = (): FederationInfo => ({
  name: 'remote',
  shared: [],
  exposes: [],
});

const opts = (): FederationOptions =>
  ({ workspaceRoot: '/ws', outputPath: 'dist' }) as FederationOptions;

describe('writeFederationInfoCore', () => {
  it('writes remoteEntry.json under workspaceRoot/outputPath', () => {
    const io = createMemoryIo();
    writeFederationInfoCore(io, info(), opts());
    expect(io.isFile('/ws/dist/remoteEntry.json')).toBe(true);
  });

  it('serialises the federation info as pretty JSON', () => {
    const io = createMemoryIo();
    const federationInfo = info();
    writeFederationInfoCore(io, federationInfo, opts());
    const written = io.readText('/ws/dist/remoteEntry.json');
    expect(JSON.parse(written)).toEqual(federationInfo);
    expect(written).toContain('\n  '); // 2-space indentation
  });
});
