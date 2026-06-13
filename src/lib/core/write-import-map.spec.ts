import { describe, expect, it } from 'vitest';
import { writeImportMapCore } from './write-import-map.js';
import { createMemoryIo } from '../utils/io/__test-helpers__/memory-io.js';
import { toChunkImport } from '../domain/core/chunk.js';
import type { SharedInfo } from '../domain/core/federation-info.contract.js';
import type { FederationOptions } from '../domain/core/federation-options.contract.js';

const opts = (): FederationOptions =>
  ({ workspaceRoot: '/ws', outputPath: 'dist' }) as FederationOptions;

const shared = (packageName: string, outFileName: string): SharedInfo =>
  ({ packageName, outFileName }) as SharedInfo;

const readMap = (io: ReturnType<typeof createMemoryIo>) =>
  JSON.parse(io.readText('/ws/dist/importmap.json'));

describe('writeImportMapCore', () => {
  it('maps each external package name to its output file', () => {
    const io = createMemoryIo();
    writeImportMapCore(io, { externals: [shared('react', 'react.js')] }, opts());
    expect(readMap(io)).toEqual({ imports: { react: 'react.js' } });
  });

  it('adds chunk entries keyed by their chunk import specifier', () => {
    const io = createMemoryIo();
    writeImportMapCore(
      io,
      { externals: [], chunks: { main: ['chunk-a.js'] } },
      opts()
    );
    expect(readMap(io).imports).toEqual({ [toChunkImport('chunk-a.js')]: 'chunk-a.js' });
  });

  it('includes integrity only for referenced urls', () => {
    const io = createMemoryIo();
    writeImportMapCore(
      io,
      { externals: [shared('react', 'react.js')] },
      opts(),
      { 'react.js': 'sha384-abc', 'unused.js': 'sha384-xyz' }
    );
    expect(readMap(io).integrity).toEqual({ 'react.js': 'sha384-abc' });
  });

  it('omits the integrity field when nothing matches', () => {
    const io = createMemoryIo();
    writeImportMapCore(
      io,
      { externals: [shared('react', 'react.js')] },
      opts(),
      { 'other.js': 'sha384-abc' }
    );
    expect(readMap(io)).not.toHaveProperty('integrity');
  });

  it('writes importmap.json under workspaceRoot/outputPath', () => {
    const io = createMemoryIo();
    writeImportMapCore(io, { externals: [] }, opts());
    expect(io.isFile('/ws/dist/importmap.json')).toBe(true);
  });
});
