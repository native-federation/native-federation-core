import * as path from 'path';
import type { OutputFile } from '../../domain/core/federation-info.contract.js';

// Adapters write every bundle flat into its output folder, so a file is known by its base name.
export function toOutputFiles(files: string[], platform: OutputFile['platform']): OutputFile[] {
  return files.map(file => ({ fileName: path.basename(file), platform }));
}
