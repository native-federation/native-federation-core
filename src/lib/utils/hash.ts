import { nodeIo } from './io/node-io-adapter.js';
import type { FileReaderPort, HashPort } from '../domain/utils/io-port.contract.js';

export type SriAlgorithm = 'sha256' | 'sha384' | 'sha512';

type HashDeps = FileReaderPort & HashPort;

// Every hash here is a sha256 of the bytes it names; they differ only in the slot the result has
// to fit. SRI is the exception: the browser dictates sha384 and the base64 digest verbatim.

// Single-case, so two names differing only in case cannot exist: on a case-insensitive filesystem
// those are one file, and the second chunk written would silently overwrite the first.
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export const DEFAULT_HASH_LENGTH = 8;

// The length is the bundler's so that every reference keeps its byte length and the emitted source
// maps stay valid; 8 chars of base32 is a 40-bit truncation, ~5e-7 collisions across 1000 chunks.
export function hashChunkContent(io: HashPort, text: string, length: number): string {
  const digest = Buffer.from(io.hash('sha256', text).base64(), 'base64');
  let name = '';
  for (let index = 0; index < length; index++) {
    name += BASE32[digest[index % digest.length]! % BASE32.length];
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
