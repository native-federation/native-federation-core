import * as path from 'path';
import type {
  FileReaderPort,
  FileWriterPort,
  HashPort,
} from '../../domain/utils/io-port.contract.js';
import { CHUNK_PREFIX } from '../../domain/core/chunk.js';
import { DEFAULT_HASH_SLOT, hashChunkContent, hashSlotOf } from '../../utils/hash.js';
import { isSourceFile } from './rewrite-chunk-imports.js';

type RenameDeps = FileReaderPort & FileWriterPort & HashPort;

// The hash segment of a bundler's output name, in esbuild's, Rollup's or a hex alphabet, and at
// least as long as the 8 characters both bundlers write: a trailing word like `-vendor` is not one.
const HASH_SEGMENT = /-([A-Za-z0-9_$]{8,})$/;

const SOURCE_EXTENSION = /\.(m|c)?js$/;
const SOURCE_MAP_COMMENT = /\/\/# sourceMappingURL=\S+\s*$/;

// `'./chunk-x.js'` as the bundler wrote it, or `'@nf-internal/chunk-x'` after the import rewrite.
const CHUNK_REFERENCE = new RegExp(`(['"])(?:\\.\\/([^'"/]+)|${CHUNK_PREFIX}\\/([^'"/]+))\\1`, 'g');

/**
 * The bundler names a chunk after the build graph it belongs to, so two applications can emit
 * different bytes under one name and identical bytes under two. Both break sharing by name: the
 * first hands one application the other's file, the second keeps one module as two. The hash
 * segment is therefore replaced by a hash of the bytes that will be served, dependencies first,
 * because renaming a chunk changes the text of everything that imports it.
 *
 * `chunks` and `referrers` are file names inside `dir`; only the former are renamed, the latter
 * have their references updated. Files that are not scripts are left alone. Returns the renames
 * as old name → new name.
 */
export function renameChunksByContentCore(
  io: RenameDeps,
  dir: string,
  chunks: string[],
  referrers: string[]
): Map<string, string> {
  const scripts = chunks.filter(isSourceFile);
  const chunkSet = new Set(scripts);
  const byStem = new Map(scripts.map(file => [stemOf(file), file]));
  const renamed = new Map<string, string>();
  const bodies = new Map<string, string>();
  const texts = new Map<string, string>();

  const textOf = (file: string): string => {
    let text = texts.get(file);
    if (text === undefined) {
      text = io.readText(path.join(dir, file));
      texts.set(file, text);
    }
    return text;
  };

  const chunkOf = (relative: string | undefined, bare: string | undefined): string | undefined => {
    const file = relative !== undefined ? relative : byStem.get(bare!);
    return file && chunkSet.has(file) ? file : undefined;
  };

  const referencedChunks = (text: string): string[] => {
    const found: string[] = [];
    for (const [, , relative, bare] of text.matchAll(CHUNK_REFERENCE)) {
      const file = chunkOf(relative, bare);
      if (file) found.push(file);
    }
    return found;
  };

  const withRenames = (text: string): string =>
    text.replace(CHUNK_REFERENCE, (match, quote: string, relative?: string, bare?: string) => {
      const file = chunkOf(relative, bare);
      const target = file && renamed.get(file);
      if (!target) return match;
      return relative !== undefined
        ? `${quote}./${target}${quote}`
        : `${quote}${CHUNK_PREFIX}/${stemOf(target)}${quote}`;
    });

  const bodyOf = (file: string): string =>
    withRenames(textOf(file)).replace(SOURCE_MAP_COMMENT, '');

  const assign = (file: string, body: string): void => {
    const target = hashedName(io, file, body);
    const taken = bodies.get(target);
    if (taken !== undefined && taken !== body) {
      throw new Error(`Chunks with different content hash to the same name '${target}'.`);
    }
    bodies.set(target, body);
    renamed.set(file, target);
  };

  // A cycle is hashed as one unit: inside it the bundler's names are replaced by the position of
  // the referenced member, so the names it chose leave no trace in any member's name.
  const settleCycle = (members: string[]): void => {
    const cycle = new Set(members);
    const canonical = (body: string, position: (file: string) => string): string =>
      body.replace(CHUNK_REFERENCE, (match, quote: string, relative?: string, bare?: string) => {
        const file = chunkOf(relative, bare);
        return file && cycle.has(file) ? `${quote}${position(file)}${quote}` : match;
      });
    const shape = new Map(members.map(file => [file, canonical(bodyOf(file), () => '#')]));
    const order = [...members].sort((a, b) => compare(shape.get(a)!, shape.get(b)!));
    const index = new Map(order.map((file, at) => [file, at]));
    const unit = order.map(file => canonical(bodyOf(file), at => `#${index.get(at)}`)).join('\n');
    for (const file of order) assign(file, `${unit}\n${index.get(file)}`);
  };

  const components = stronglyConnected(scripts, file => referencedChunks(textOf(file)));
  for (const component of components) {
    const [only] = component;
    if (component.length === 1 && !referencedChunks(textOf(only!)).includes(only!)) {
      assign(only!, bodyOf(only!));
    } else {
      settleCycle(component);
    }
  }

  // Written only once every name is final: inside a cycle a member is hashed before its partner
  // is renamed, so its text is settled here rather than at hashing time.
  for (const file of scripts) {
    const target = renamed.get(file)!;
    const source = path.join(dir, file);
    const text = withRenames(textOf(file)).split(`${file}.map`).join(`${target}.map`);
    io.writeText(path.join(dir, target), text);
    if (target === file) continue;
    io.remove(source);
    if (io.exists(`${source}.map`)) {
      io.copyFile(`${source}.map`, path.join(dir, `${target}.map`));
      io.remove(`${source}.map`);
    }
  }

  for (const file of referrers) {
    const filePath = path.join(dir, file);
    const text = io.readText(filePath);
    const updated = withRenames(text);
    if (updated !== text) io.writeText(filePath, updated);
  }

  for (const [file, target] of renamed) {
    if (file === target) renamed.delete(file);
  }
  return renamed;
}

/** Tarjan's algorithm; a component is emitted after every component it references. */
function stronglyConnected(nodes: string[], edges: (node: string) => string[]): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];

  const visit = (node: string): void => {
    index.set(node, index.size);
    low.set(node, index.get(node)!);
    stack.push(node);
    onStack.add(node);
    for (const next of edges(node)) {
      if (!index.has(next)) {
        visit(next);
        low.set(node, Math.min(low.get(node)!, low.get(next)!));
      } else if (onStack.has(next)) {
        low.set(node, Math.min(low.get(node)!, index.get(next)!));
      }
    }
    if (low.get(node) !== index.get(node)) return;
    const component: string[] = [];
    let member: string;
    do {
      member = stack.pop()!;
      onStack.delete(member);
      component.push(member);
    } while (member !== node);
    components.push(component);
  };

  for (const node of nodes) if (!index.has(node)) visit(node);
  return components;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function stemOf(file: string): string {
  return file.replace(SOURCE_EXTENSION, '');
}

function hashedName(io: HashPort, file: string, body: string): string {
  const extension = file.match(SOURCE_EXTENSION)?.[0] ?? '';
  const stem = stemOf(file);
  const segment = stem.match(HASH_SEGMENT);
  const slot = segment ? hashSlotOf(segment[1]!) : DEFAULT_HASH_SLOT;
  const base = segment ? stem.slice(0, -segment[0].length) : stem;
  return `${base}-${hashChunkContent(io, body, slot)}${extension}`;
}
