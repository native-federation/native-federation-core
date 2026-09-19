import { describe, expect, it } from 'vitest';
import { renameChunksByContentCore } from './rename-chunks-by-content.js';
import { createMemoryIo } from '../../utils/io/__test-helpers__/memory-io.js';

const CHUNK = /^chunk-[A-Z2-7]{8}\.js$/;

describe('renameChunksByContentCore', () => {
  it('names a chunk after its content, keeping the shape of the bundler name', () => {
    const io = createMemoryIo().setFile('/out/chunk-AAAAAAAA.js', 'export const a = 1;\n');

    const renamed = renameChunksByContentCore(io, '/out', ['chunk-AAAAAAAA.js'], []);

    const target = renamed.get('chunk-AAAAAAAA.js')!;
    expect(target).toMatch(CHUNK);
    expect(target).not.toBe('chunk-AAAAAAAA.js');
    expect(io.exists('/out/chunk-AAAAAAAA.js')).toBe(false);
    expect(io.readText(`/out/${target}`)).toBe('export const a = 1;\n');
  });

  it('gives identical bytes the same name whatever the bundler called them', () => {
    const a = createMemoryIo().setFile('/a/chunk-AAAAAAAA.js', 'export const x = 1;\n');
    const b = createMemoryIo().setFile('/b/chunk-BBBBBBBB.js', 'export const x = 1;\n');

    const fromA = renameChunksByContentCore(a, '/a', ['chunk-AAAAAAAA.js'], []);
    const fromB = renameChunksByContentCore(b, '/b', ['chunk-BBBBBBBB.js'], []);

    expect(fromA.get('chunk-AAAAAAAA.js')).toBe(fromB.get('chunk-BBBBBBBB.js'));
  });

  it('gives different bytes different names although the bundler agreed on one', () => {
    const a = createMemoryIo().setFile('/a/chunk-SAMENAME.js', 'export const x = 1;\n');
    const b = createMemoryIo().setFile('/b/chunk-SAMENAME.js', 'export const x = 2;\n');

    const fromA = renameChunksByContentCore(a, '/a', ['chunk-SAMENAME.js'], []);
    const fromB = renameChunksByContentCore(b, '/b', ['chunk-SAMENAME.js'], []);

    expect(fromA.get('chunk-SAMENAME.js')).not.toBe(fromB.get('chunk-SAMENAME.js'));
  });

  it('renames dependencies first and updates both specifier forms in the importers', () => {
    const io = createMemoryIo()
      .setFile('/out/chunk-LEAFLEAF.js', 'export const leaf = 1;\n')
      .setFile(
        '/out/chunk-TRUNKTRU.js',
        "import { leaf } from './chunk-LEAFLEAF.js';\nexport { leaf };\n"
      )
      .setFile('/out/entry.js', "export * from '@nf-internal/chunk-TRUNKTRU';\n");

    const renamed = renameChunksByContentCore(
      io,
      '/out',
      ['chunk-TRUNKTRU.js', 'chunk-LEAFLEAF.js'],
      ['entry.js']
    );

    const leaf = renamed.get('chunk-LEAFLEAF.js')!;
    const trunk = renamed.get('chunk-TRUNKTRU.js')!;
    expect(io.readText(`/out/${trunk}`)).toBe(
      `import { leaf } from './${leaf}';\nexport { leaf };\n`
    );
    expect(io.readText('/out/entry.js')).toBe(
      `export * from '@nf-internal/${trunk.replace(/\.js$/, '')}';\n`
    );
  });

  it('derives the importer name from the renamed dependency, so a changed leaf renames the trunk', () => {
    const build = (leaf: string) =>
      createMemoryIo()
        .setFile('/out/chunk-LEAFLEAF.js', leaf)
        .setFile('/out/chunk-TRUNKTRU.js', "export * from './chunk-LEAFLEAF.js';\n");

    const first = build('export const leaf = 1;\n');
    const second = build('export const leaf = 2;\n');
    const chunks = ['chunk-TRUNKTRU.js', 'chunk-LEAFLEAF.js'];

    const fromFirst = renameChunksByContentCore(first, '/out', chunks, []);
    const fromSecond = renameChunksByContentCore(second, '/out', chunks, []);

    expect(fromFirst.get('chunk-TRUNKTRU.js')).not.toBe(fromSecond.get('chunk-TRUNKTRU.js'));
  });

  it('settles an import cycle with every reference pointing at a file that exists', () => {
    const io = createMemoryIo()
      .setFile('/out/chunk-AAAAAAAA.js', "import './chunk-BBBBBBBB.js';\nexport const a = 1;\n")
      .setFile('/out/chunk-BBBBBBBB.js', "import './chunk-AAAAAAAA.js';\nexport const b = 1;\n");

    const renamed = renameChunksByContentCore(
      io,
      '/out',
      ['chunk-AAAAAAAA.js', 'chunk-BBBBBBBB.js'],
      []
    );

    for (const target of renamed.values()) {
      for (const [, , relative] of io
        .readText(`/out/${target}`)
        .matchAll(/(['"])\.\/([^'"]+)\1/g)) {
        expect(io.exists(`/out/${relative}`)).toBe(true);
      }
    }
  });

  it('moves the source map along and keeps the sourceMappingURL comment in step', () => {
    const io = createMemoryIo()
      .setFile(
        '/out/chunk-AAAAAAAA.js',
        'export const a = 1;\n//# sourceMappingURL=chunk-AAAAAAAA.js.map\n'
      )
      .setFile('/out/chunk-AAAAAAAA.js.map', '{"version":3}');

    const renamed = renameChunksByContentCore(io, '/out', ['chunk-AAAAAAAA.js'], []);

    const target = renamed.get('chunk-AAAAAAAA.js')!;
    expect(io.readText(`/out/${target}`)).toBe(
      `export const a = 1;\n//# sourceMappingURL=${target}.map\n`
    );
    expect(io.readText(`/out/${target}.map`)).toBe('{"version":3}');
    expect(io.exists('/out/chunk-AAAAAAAA.js.map')).toBe(false);
  });

  it('does not let the sourceMappingURL comment shape the hash', () => {
    const plain = createMemoryIo().setFile('/out/chunk-AAAAAAAA.js', 'export const a = 1;\n');
    const mapped = createMemoryIo().setFile(
      '/out/chunk-BBBBBBBB.js',
      'export const a = 1;\n//# sourceMappingURL=chunk-BBBBBBBB.js.map\n'
    );

    const fromPlain = renameChunksByContentCore(plain, '/out', ['chunk-AAAAAAAA.js'], []);
    const fromMapped = renameChunksByContentCore(mapped, '/out', ['chunk-BBBBBBBB.js'], []);

    expect(fromPlain.get('chunk-AAAAAAAA.js')).toBe(fromMapped.get('chunk-BBBBBBBB.js'));
  });

  it('leaves a chunk whose name already matches its content alone', () => {
    const io = createMemoryIo().setFile('/out/chunk-AAAAAAAA.js', 'export const a = 1;\n');
    const first = renameChunksByContentCore(io, '/out', ['chunk-AAAAAAAA.js'], []);
    const target = first.get('chunk-AAAAAAAA.js')!;

    const second = renameChunksByContentCore(io, '/out', [target], []);

    expect(second.size).toBe(0);
    expect(io.exists(`/out/${target}`)).toBe(true);
  });

  it('touches neither a reference to a file outside the chunk set nor a bare package', () => {
    const io = createMemoryIo()
      .setFile(
        '/out/chunk-AAAAAAAA.js',
        "import 'react';\nimport './other.js';\nexport const a = 1;\n"
      )
      .setFile('/out/other.js', 'export {};\n');

    const renamed = renameChunksByContentCore(io, '/out', ['chunk-AAAAAAAA.js'], []);

    const target = renamed.get('chunk-AAAAAAAA.js')!;
    expect(io.readText(`/out/${target}`)).toBe(
      "import 'react';\nimport './other.js';\nexport const a = 1;\n"
    );
    expect(io.exists('/out/other.js')).toBe(true);
  });

  it('appends a hash segment to a name that carries none', () => {
    const io = createMemoryIo().setFile('/out/lazy.js', 'export const a = 1;\n');

    const renamed = renameChunksByContentCore(io, '/out', ['lazy.js'], []);

    expect(renamed.get('lazy.js')).toMatch(/^lazy-[A-Z2-7]{8}\.js$/);
  });
});
