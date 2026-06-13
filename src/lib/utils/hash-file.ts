import { nodeIo } from './io/node-io-adapter.js';
import type { FileReaderPort, HashPort } from '../domain/utils/io-port.contract.js';

export type SriAlgorithm = 'sha256' | 'sha384' | 'sha512';

type HashDeps = FileReaderPort & HashPort;

export function hashFile(fileName: string): string {
  return hashFileCore(nodeIo, fileName);
}

export function integrityForFile(fileName: string, algorithm: SriAlgorithm = 'sha384'): string {
  return integrityForFileCore(nodeIo, fileName, algorithm);
}

export function hashFileCore(io: HashDeps, fileName: string): string {
  return io.hash('md5', io.readBytes(fileName)).hex();
}

export function integrityForFileCore(
  io: HashDeps,
  fileName: string,
  algorithm: SriAlgorithm = 'sha384'
): string {
  return `${algorithm}-${io.hash(algorithm, io.readBytes(fileName)).base64()}`;
}
