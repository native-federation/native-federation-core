import * as path from 'path';
import type { IoPort } from '../../../domain/utils/io-port.contract.js';
import type {
  NFBuildAdapter,
  NFBuildAdapterOptions,
  NFBuildAdapterResult,
} from '../../../domain/core/build-adapter.contract.js';

export interface FakeBuildAdapter extends NFBuildAdapter {
  readonly calls: {
    setup: Array<{ name: string; options: NFBuildAdapterOptions }>;
    build: Array<{ name: string; modifiedFiles?: string[] }>;
    dispose: Array<string | undefined>;
  };
}

type ResultsFor = NFBuildAdapterResult[] | ((name: string) => NFBuildAdapterResult[]);

// When `results` is omitted, `build()` echoes the most recent `setup()` for that
// name (one result per entry point); with `io`, those files are also written.
export function createFakeBuildAdapter(
  options: { io?: IoPort; results?: ResultsFor } = {}
): FakeBuildAdapter {
  const calls: FakeBuildAdapter['calls'] = { setup: [], build: [], dispose: [] };

  const echoFromSetup = (name: string): NFBuildAdapterResult[] => {
    const setup = [...calls.setup].reverse().find(s => s.name === name);
    if (!setup) return [];
    return setup.options.entryPoints.map(ep => ({
      fileName: path.join(setup.options.outdir, ep.outName),
    }));
  };

  return {
    calls,
    async setup(name, opts) {
      calls.setup.push({ name, options: opts });
    },
    async build(name, opts) {
      calls.build.push({ name, modifiedFiles: opts?.modifiedFiles });
      const results = options.results
        ? typeof options.results === 'function'
          ? options.results(name)
          : options.results
        : echoFromSetup(name);
      if (options.io) {
        for (const r of results) options.io.writeText(r.fileName, 'export {};\n');
      }
      return results;
    },
    async dispose(name) {
      calls.dispose.push(name);
    },
  };
}
