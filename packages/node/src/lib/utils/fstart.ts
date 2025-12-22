import { initNodeFederation } from '../node/init-node-federation.js';
import { parseFStartArgs } from './fstart-args-parser.js';

const args = parseFStartArgs();

(async () => {
  await initNodeFederation({
    ...(args.remotesOrManifestUrl ? { remotesOrManifestUrl: args.remotesOrManifestUrl } : {}),
    relBundlePath: args.relBundlePath,
  });

  await import(args.entry);
})();
