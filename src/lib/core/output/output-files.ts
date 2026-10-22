import * as path from 'path';
import type { OutputFile } from '../../domain/core/federation-info.contract.js';
import type { NFBuildAdapterResult } from '../../domain/core/build-adapter.contract.js';
import type { FileReaderPort } from '../../domain/utils/io-port.contract.js';
import { formatList } from '../../utils/format-list.js';

// Adapters write every bundle flat into its output folder, so a file is known by its base name.
export function toOutputFiles(files: string[], platform: OutputFile['platform']): OutputFile[] {
  return files.map(file => ({ fileName: path.basename(file), platform }));
}

// A relative name is read against cwd, not outdir, so integrity would skip the file without a word.
export function assertAbsoluteFileNames(results: NFBuildAdapterResult[]): void {
  const relative = results.find(result => !path.isAbsolute(result.fileName));
  if (relative) {
    throw new Error(
      `NFBuildAdapter.build returned a relative fileName '${relative.fileName}'; it must be absolute.`
    );
  }
}

// Core reads each file as `<outdir>/<base name>`: one in a subfolder is as missing as one not written.
export function assertWrittenToOutdir(io: FileReaderPort, files: string[], outdir: string): void {
  const missing = files.filter(file => !io.exists(path.join(outdir, path.basename(file))));
  if (missing.length > 0) {
    throw new Error(
      `NFBuildAdapter.build returned ${formatList(missing, 3)}, missing from outdir '${outdir}': ` +
        'written into a subfolder, or not written by this build.'
    );
  }
}
