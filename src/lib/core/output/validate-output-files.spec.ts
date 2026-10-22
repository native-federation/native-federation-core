import { afterEach, describe, expect, it, vi } from 'vitest';
import * as path from 'path';
import type {
  FederationInfo,
  OutputFile,
  SharedInfo,
} from '../../domain/core/federation-info.contract.js';
import { createMemoryIo } from '../../utils/io/__test-helpers__/memory-io.js';
import { logger } from '../../utils/logger.js';
import { validateOutputFilesCore } from './validate-output-files.js';

const OUT = path.resolve('/ws/dist');
const out = (file: string) => path.join(OUT, file);

const browser = (...fileNames: string[]): OutputFile[] =>
  fileNames.map(fileName => ({ fileName, platform: 'browser' }));

function shared(packageName: string, outFileName: string): SharedInfo {
  return {
    singleton: true,
    strictVersion: true,
    requiredVersion: '^1.0.0',
    version: '1.0.0',
    packageName,
    outFileName,
  };
}

// Every way remoteEntry.json can name a file: an expose, a shared or mapping entry (flat and
// dense), a dense chunk and a non-dense chunk (published as a shared entry).
const INFO: FederationInfo = {
  name: 'mfe',
  exposes: [{ key: './Comp', outFileName: 'Comp.js' }],
  shared: [
    shared('rxjs', 'rxjs.js'),
    shared('@nf-internal/chunk-B', 'chunk-B.js'),
    {
      ...shared('@angular/core', ''),
      entries: { '@angular/core': 'core.js', '@angular/core/rxjs-interop': 'interop.js' },
    } as never,
  ],
  chunks: { 'mapping-or-exposed': ['chunk-A.js'] },
};

describe('validateOutputFilesCore', () => {
  afterEach(() => vi.restoreAllMocks());

  it('passes when every output file is in the output folder', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const io = createMemoryIo().setFile(out('Comp.js'), '').setFile(out('Comp.js.map'), '');

    validateOutputFilesCore(io, OUT, INFO, browser('Comp.js', 'Comp.js.map'));

    expect(warn).not.toHaveBeenCalled();
  });

  // The host would load a remote whose import map points at nothing: a white screen at runtime.
  it.each(['Comp.js', 'rxjs.js', 'interop.js', 'chunk-A.js', 'chunk-B.js'])(
    'throws for a missing file remoteEntry.json names (%s)',
    fileName => {
      expect(() => validateOutputFilesCore(createMemoryIo(), OUT, INFO, browser(fileName))).toThrow(
        `remoteEntry.json names '${fileName}', missing from '${OUT}': written into a subfolder, ` +
          "or deleted after it was written (e.g. by Vite's emptyOutDir)."
      );
    }
  );

  // A missing outputFiles entry was never fatal (core#181), and a source map or stylesheet
  // nothing loads by name keeps it that way.
  it('warns once, listing every missing file remoteEntry.json does not name', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const io = createMemoryIo().setFile(out('Comp.js'), '');

    validateOutputFilesCore(io, OUT, INFO, browser('Comp.js', 'Comp.js.map', 'Comp.css'));

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/^Output file\(s\) 'Comp\.js\.map', 'Comp\.css' missing from /)
    );
  });

  // Core knows a file by its base name in the output folder only.
  it('counts a file written into a subfolder as missing', () => {
    const io = createMemoryIo().setFile(out('assets/chunk-A.js'), '');

    expect(() => validateOutputFilesCore(io, OUT, INFO, browser('chunk-A.js'))).toThrow(
      /names 'chunk-A\.js', missing from/
    );
  });
});
