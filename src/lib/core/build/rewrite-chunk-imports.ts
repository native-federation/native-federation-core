import * as path from 'path';
import { initSync, parse } from 'es-module-lexer';
import { decode, encode } from '@jridgewell/sourcemap-codec';
import type { FileReaderPort, FileWriterPort } from '../../domain/utils/io-port.contract.js';
import { toChunkImport } from '../../domain/core/chunk.js';

export interface SpecifierEdit {
  /** Offset of the first character of the specifier text (inside the quotes). */
  start: number;
  /** Offset just past the specifier text. */
  end: number;
  text: string;
}

/**
 * Every `./x.js` specifier of a static import, an export-from or a dynamic `import()`, as
 * an edit that swaps the specifier text for its `@nf-internal/x` form. The edits are the
 * only change the rewrite makes, so the source map esbuild wrote next to the file stays
 * valid apart from the columns after an edit on the same line, which `shiftSourceMap`
 * moves along.
 */
export function collectSpecifierEdits(sourceCode: string, fileName: string): SpecifierEdit[] {
  initSync();
  const [imports] = parse(sourceCode, fileName);
  const edits: SpecifierEdit[] = [];

  for (const imp of imports) {
    // import.meta, a non-literal dynamic argument, or not a chunk reference
    if (imp.d === -2 || imp.n === undefined || !imp.n.startsWith('./')) continue;

    let start = imp.s;
    let end = imp.e;

    if (imp.d > -1) {
      // dynamic import: s/e include the quotes, step inside them
      const quote = sourceCode[start];
      if (quote !== '"' && quote !== "'") continue;
      start += 1;
      end -= 1;
    }

    edits.push({ start, end, text: toChunkImport(imp.n) });
  }

  return edits.sort((a, b) => a.start - b.start);
}

export function applyEdits(sourceCode: string, edits: SpecifierEdit[]): string {
  let result = '';
  let last = 0;

  for (const edit of edits) {
    result += sourceCode.slice(last, edit.start) + edit.text;
    last = edit.end;
  }

  return result + sourceCode.slice(last);
}

/**
 * Moves the generated columns of every segment that sits after an edit on the same line
 * by the length the edit added. Nothing else in the map is read or written, so sources,
 * names and original positions survive untouched.
 */
function shiftMappings(mappings: string, code: string, edits: SpecifierEdit[]): string {
  const lineStarts = [0];
  for (let i = 0; i < code.length; i++) {
    if (code.charCodeAt(i) === 10) lineStarts.push(i + 1);
  }

  let line = 0;
  const byLine = new Map<number, { start: number; end: number; delta: number }[]>();

  for (const edit of edits) {
    while (line + 1 < lineStarts.length && (lineStarts[line + 1] ?? Infinity) <= edit.start) line++;
    const lineStart = lineStarts[line] ?? 0;
    const list = byLine.get(line) ?? [];
    list.push({
      start: edit.start - lineStart,
      end: edit.end - lineStart,
      delta: edit.text.length - (edit.end - edit.start),
    });
    byLine.set(line, list);
  }

  const decoded = decode(mappings);

  for (const [editLine, list] of byLine) {
    for (const segment of decoded[editLine] ?? []) {
      let shift = 0;
      for (const edit of list) {
        if (edit.end <= segment[0]) {
          shift += edit.delta;
        } else if (edit.start < segment[0]) {
          // starts inside the replaced span: clamp to its start (defensive, real bundles
          // never map into the middle of a specifier literal)
          shift += edit.start - segment[0];
        }
      }
      segment[0] += shift;
    }
  }

  return encode(decoded);
}

/** Shifts the map at `mapPath`, if there is one, for the edits made to `sourceCode`. */
export function shiftSourceMap(
  io: FileReaderPort & FileWriterPort,
  mapPath: string,
  sourceCode: string,
  edits: SpecifierEdit[]
): void {
  if (edits.length === 0 || !io.exists(mapPath)) return;

  const map = JSON.parse(io.readText(mapPath)) as { mappings?: string };
  if (!map.mappings) return;

  map.mappings = shiftMappings(map.mappings, sourceCode, edits);
  io.writeText(mapPath, JSON.stringify(map));
}

export function rewriteChunkImportsCore(
  io: FileReaderPort & FileWriterPort,
  filePath: string
): void {
  const sourceCode = io.readText(filePath);
  const edits = collectSpecifierEdits(sourceCode, path.basename(filePath));
  if (edits.length === 0) return;

  io.writeText(filePath, applyEdits(sourceCode, edits));
  shiftSourceMap(io, `${filePath}.map`, sourceCode, edits);
}

export function isSourceFile(fileName: string): boolean {
  return !!fileName.match(/.(m|c)?js$/);
}
