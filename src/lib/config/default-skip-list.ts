import type { PreparedSkipList, SkipFn, SkipList } from '../domain/config/skip-list.contract.js';

export const DEFAULT_SKIP_LIST: SkipList = [
  '@softarc/native-federation',
  '@softarc/native-federation-core',
  '@softarc/native-federation-node',
  '@softarc/native-federation-esbuild',
  '@softarc/native-federation-runtime',
  '@softarc/native-federation-orchestrator',
  'vanilla-native-federation',
  'es-module-shims',
  'tslib/',
  pkg => pkg.startsWith('@types/'),
];

export function prepareSkipList(skipList: SkipList): PreparedSkipList {
  return {
    strings: new Set<string>(skipList.filter(e => typeof e === 'string') as string[]),
    functions: skipList.filter(e => typeof e === 'function') as SkipFn[],
    regexps: skipList.filter(e => typeof e === 'object') as RegExp[],
  };
}

export function isInSkipList(entry: string, skipList: PreparedSkipList): boolean {
  if (skipList.strings.has(entry)) {
    return true;
  }

  if (skipList.functions.find(f => f(entry))) {
    return true;
  }

  if (skipList.regexps.find(r => r.test(entry))) {
    return true;
  }

  return false;
}
