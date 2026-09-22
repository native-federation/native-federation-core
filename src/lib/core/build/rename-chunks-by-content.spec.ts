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

  it('keeps the slot of a name the bundler wrote in another alphabet', () => {
    const io = createMemoryIo()
      .setFile('/out/index-DqQoMqkL.js', 'export const a = 1;\n')
      .setFile('/out/chunk-1a2b3c4d.js', 'export const b = 1;\n');

    const renamed = renameChunksByContentCore(
      io,
      '/out',
      ['index-DqQoMqkL.js', 'chunk-1a2b3c4d.js'],
      []
    );

    expect(renamed.get('index-DqQoMqkL.js')).toMatch(/^index-[A-Za-z0-9_$]{8}\.js$/);
    expect(renamed.get('chunk-1a2b3c4d.js')).toMatch(/^chunk-[0-9a-f]{8}\.js$/);
  });

  it('keeps a Rollup segment with `$` at its length', () => {
    const io = createMemoryIo().setFile('/out/index-Dq$oMqkL.js', 'export const a = 1;\n');

    const renamed = renameChunksByContentCore(io, '/out', ['index-Dq$oMqkL.js'], []);

    expect(renamed.get('index-Dq$oMqkL.js')).toMatch(/^index-[A-Za-z0-9_$]{8}\.js$/);
  });

  it('does not take a short trailing word for a hash segment', () => {
    const io = createMemoryIo().setFile('/out/lazy-panel.js', 'export const a = 1;\n');

    const renamed = renameChunksByContentCore(io, '/out', ['lazy-panel.js'], []);

    expect(renamed.get('lazy-panel.js')).toMatch(/^lazy-panel-[A-Z2-7]{8}\.js$/);
  });

  it('leaves a file that is not a script alone', () => {
    const io = createMemoryIo()
      .setFile('/out/chunk-AAAAAAAA.js', 'export const a = 1;\n')
      .setFile('/out/styles-BBBBBBBB.css', '.a{}');

    const renamed = renameChunksByContentCore(
      io,
      '/out',
      ['chunk-AAAAAAAA.js', 'styles-BBBBBBBB.css'],
      []
    );

    expect(renamed.has('styles-BBBBBBBB.css')).toBe(false);
    expect(io.exists('/out/styles-BBBBBBBB.css')).toBe(true);
  });

  it('names the members of a cycle after the cycle, whatever the bundler called them', () => {
    const build = (a: string, b: string, aText: string) =>
      createMemoryIo()
        .setFile(`/out/${a}`, `import './${b}';\n${aText}`)
        .setFile(`/out/${b}`, `import './${a}';\nexport const b = 1;\n`);

    const first = build('chunk-AAAAAAAA.js', 'chunk-BBBBBBBB.js', 'export const a = 1;\n');
    const second = build('chunk-CCCCCCCC.js', 'chunk-DDDDDDDD.js', 'export const a = 1;\n');
    const changed = build('chunk-AAAAAAAA.js', 'chunk-BBBBBBBB.js', 'export const a = 2;\n');

    const fromFirst = renameChunksByContentCore(
      first,
      '/out',
      ['chunk-AAAAAAAA.js', 'chunk-BBBBBBBB.js'],
      []
    );
    const fromSecond = renameChunksByContentCore(
      second,
      '/out',
      ['chunk-CCCCCCCC.js', 'chunk-DDDDDDDD.js'],
      []
    );
    const fromChanged = renameChunksByContentCore(
      changed,
      '/out',
      ['chunk-AAAAAAAA.js', 'chunk-BBBBBBBB.js'],
      []
    );

    expect(fromFirst.get('chunk-AAAAAAAA.js')).toBe(fromSecond.get('chunk-CCCCCCCC.js'));
    expect(fromFirst.get('chunk-BBBBBBBB.js')).toBe(fromSecond.get('chunk-DDDDDDDD.js'));
    expect(fromFirst.get('chunk-BBBBBBBB.js')).not.toBe(fromChanged.get('chunk-BBBBBBBB.js'));
    expect(first.readText(`/out/${fromFirst.get('chunk-BBBBBBBB.js')}`)).toBe(
      second.readText(`/out/${fromSecond.get('chunk-DDDDDDDD.js')}`)
    );
  });

  it('refuses two chunks whose bytes differ but hash alike', () => {
    const memory = createMemoryIo()
      .setFile('/out/chunk-AAAAAAAA.js', 'export const a = 1;\n')
      .setFile('/out/chunk-BBBBBBBB.js', 'export const b = 2;\n');
    const io = {
      ...memory,
      hash: () => ({ hex: () => '00', base64: () => Buffer.alloc(32).toString('base64') }),
    };

    expect(() =>
      renameChunksByContentCore(io, '/out', ['chunk-AAAAAAAA.js', 'chunk-BBBBBBBB.js'], [])
    ).toThrow(/same name/);
  });

  it('appends a hash segment to a name that carries none', () => {
    const io = createMemoryIo().setFile('/out/lazy.js', 'export const a = 1;\n');

    const renamed = renameChunksByContentCore(io, '/out', ['lazy.js'], []);

    expect(renamed.get('lazy.js')).toMatch(/^lazy-[A-Z2-7]{8}\.js$/);
  });
});
