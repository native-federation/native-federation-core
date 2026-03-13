import { pathToFileURL } from 'node:url';
import * as path from 'node:path';
import { initNodeFederation } from '../node/init-node-federation.js';
import { parseFStartArgs } from './fstart-args-parser.js';

const args = parseFStartArgs();

(async () => {
  await initNodeFederation({
    ...(args.remotesOrManifestUrl ? { remotesOrManifestUrl: args.remotesOrManifestUrl } : {}),
    relBundlePath: args.relBundlePath,
  });

  const entryUrl = path.isAbsolute(args.entry) ? pathToFileURL(args.entry).href : args.entry;
  await import(entryUrl);
})();
