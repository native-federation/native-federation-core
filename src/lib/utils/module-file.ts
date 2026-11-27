import * as path from 'path';
import type { FileReaderPort } from '../domain/utils/io-port.contract.js';

const MODULE_EXTENSIONS = ['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs'] as const;

export function resolveModuleFile(io: FileReaderPort, p: string): string | null {
  const abs = path.resolve(p);

  if (io.isFile(abs)) return abs;

  for (const ext of MODULE_EXTENSIONS) {
    if (io.isFile(`${abs}.${ext}`)) return `${abs}.${ext}`;
  }

  if (io.isDirectory(abs)) {
    for (const ext of MODULE_EXTENSIONS) {
      const indexPath = path.join(abs, `index.${ext}`);
      if (io.isFile(indexPath)) return indexPath;
    }
  }

  return null;
}
