import { nodeIo } from './io/node-io-adapter.js';
import type { FileReaderPort, HashPort } from '../domain/utils/io-port.contract.js';

export type SriAlgorithm = 'sha256' | 'sha384' | 'sha512';

type HashDeps = FileReaderPort & HashPort;

// Every hash here is a sha256 of the bytes it names; they differ only in the slot the result has
// to fit. SRI is the exception: the browser dictates sha384 and the base64 digest verbatim.

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const HEX = '0123456789abcdef';
// Rollup's, and so Vite's: `_` and `$`, never `-`, which separates the segment from the stem.
const BASE64_ROLLUP = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_$';

export interface HashSlot {
  alphabet: string;
  length: number;
}

// base32 is the right alphabet for a fixed-width file name: 5 bits per char against hex's 4,
// and unlike base64url it survives a case-insensitive filesystem, where `chunk-Ab…` and
// `chunk-aB…` are one file and a rename would overwrite. esbuild chose it for the same reason.
export const DEFAULT_HASH_SLOT: HashSlot = { alphabet: BASE32, length: 8 };

/** The slot a bundler's hash segment was written in, read from the segment itself. */
export function hashSlotOf(segment: string): HashSlot {
  const alphabet = /^[A-Z2-7]+$/.test(segment)
    ? BASE32
    : /^[0-9a-f]+$/.test(segment)
      ? HEX
      : BASE64_ROLLUP;
  return { alphabet, length: segment.length };
}

/**
 * A chunk keeps the slot the bundler gave its name: the same length, so every reference to it
 * keeps its byte length and the emitted source maps stay valid, and the same alphabet.
 * `digest[i] % alphabet.length` keeps the low bits of each byte, so an 8-char base32 slot is a
 * 40-bit truncation of the sha256: ~5e-7 collision probability across 1000 chunks.
 */
export function hashChunkContent(io: HashPort, text: string, slot: HashSlot): string {
  const digest = Buffer.from(io.hash('sha256', text).base64(), 'base64');
  let name = '';
  for (let index = 0; index < slot.length; index++) {
    name += slot.alphabet[digest[index % digest.length]! % slot.alphabet.length];
  }
  return name;
}

/** An entry file is named after its final text; nothing constrains the slot, so it is dense. */
export function hashEntryContent(io: HashPort, text: string): string {
  return dense(io, text);
}

/** A shared bundle is cached under its version, entry point, config state and content signal. */
export function hashBuildMetadata(io: HashPort, metadata: string): string {
  return dense(io, metadata);
}

function dense(io: HashPort, data: string): string {
  return io
    .hash('sha256', data)
    .base64()
    .replace(/\//g, '_')
    .replace(/\+/g, '-')
    .replace(/=/g, '')
    .substring(0, 10);
}

export function hashFile(fileName: string): string {
  return hashFileCore(nodeIo, fileName);
}

export function hashFileCore(io: HashDeps, fileName: string): string {
  return io.hash('sha256', io.readBytes(fileName)).hex();
}

export function integrityForFileCore(
  io: HashDeps,
  fileName: string,
  algorithm: SriAlgorithm = 'sha384'
): string {
  return `${algorithm}-${io.hash(algorithm, io.readBytes(fileName)).base64()}`;
}
