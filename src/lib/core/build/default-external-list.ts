const NODE_PACKAGES = [
  'assert',
  'buffer',
  'child_process',
  'cluster',
  'crypto',
  'dgram',
  'dns',
  'events',
  'fs',
  'http',
  'https',
  'module',
  'net',
  'os',
  'path',
  'querystring',
  'readline',
  'stream',
  'timers',
  'tls',
  'tty',
  'url',
  'util',
  'v8',
  'vm',
  'zlib',
];

const DEFAULT_EXTERNAL_LIST = NODE_PACKAGES.flatMap(p => [p, 'node:' + p]);

export function sharedBundleExternals(
  platform: 'browser' | 'node',
  ignoreUnusedDeps: boolean,
  externals: string[]
): string[] {
  // If we build for the browser and don't remove unused deps from the shared config,
  // we need to exclude typical node libs to avoid compilation issues
  const useDefaultExternalList = platform === 'browser' && !ignoreUnusedDeps;

  const additionalExternals = useDefaultExternalList ? DEFAULT_EXTERNAL_LIST : [];
  return [...additionalExternals, ...externals];
}
