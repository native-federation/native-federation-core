import * as crypto from 'crypto';
import * as fs from 'fs';

export function hashFile(fileName: string): string {
  const fileBuffer = fs.readFileSync(fileName);
  const hashSum = crypto.createHash('md5');
  hashSum.update(fileBuffer);
  return hashSum.digest('hex');
}

export type SriAlgorithm = 'sha256' | 'sha384' | 'sha512';

export function integrityForFile(
  fileName: string,
  algorithm: SriAlgorithm = 'sha384'
): string {
  const fileBuffer = fs.readFileSync(fileName);
  const hash = crypto.createHash(algorithm).update(fileBuffer).digest('base64');
  return `${algorithm}-${hash}`;
}
