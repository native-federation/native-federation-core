import * as path from 'path';
import { isInSkipList } from './default-skip-list.js';
import { type PreparedSkipList } from '../domain/config/skip-list.contract.js';
import type { FileReaderPort, GlobPort } from '../domain/utils/io-port.contract.js';
import { resolvePackageJsonExportsWildcardCore } from '../utils/package/resolve-wildcard-keys.js';
import { logger } from '../utils/logger.js';
import type {
  ExternalConfig,
  IncludeSecondariesOptions,
  SharedExternalsConfig,
} from '../domain/config/external-config.contract.js';
import type { KeyValuePair } from '../domain/utils/keyvaluepair.contract.js';

function _findSecondaries(
  io: FileReaderPort,
  libPath: string,
  excludes: string[],
  shareObject: ExternalConfig,
  acc: SharedExternalsConfig,
  preparedSkipList: PreparedSkipList
): void {
  const files = io.readDir(libPath);

  const secondaries = files
    .map(f => path.join(libPath, f))
    .filter(f => io.isDirectory(f) && !f.endsWith('node_modules'));

  for (const s of secondaries) {
    if (io.exists(path.join(s, 'package.json'))) {
      const secondaryLibName = s.replace(/\\/g, '/').replace(/^.*node_modules[/]/, '');

      const inCustomSkipList = excludes.some(
        e =>
          e === secondaryLibName || (e.endsWith('*') && secondaryLibName.startsWith(e.slice(0, -1)))
      );
      if (inCustomSkipList) continue;

      if (isInSkipList(secondaryLibName, preparedSkipList)) {
        continue;
      }

      acc[secondaryLibName] = { ...shareObject };
    }

    _findSecondaries(io, s, excludes, shareObject, acc, preparedSkipList);
  }
}

function findSecondaries(
  io: FileReaderPort,
  libPath: string,
  excludes: string[],
  shareObject: ExternalConfig,
  preparedSkipList: PreparedSkipList
): SharedExternalsConfig {
  const acc = {} as SharedExternalsConfig;
  _findSecondaries(io, libPath, excludes, shareObject, acc, preparedSkipList);
  return acc;
}

export function getSecondaries(
  io: FileReaderPort & GlobPort,
  includeSecondaries: IncludeSecondariesOptions,
  libPath: string,
  key: string,
  shareObject: ExternalConfig,
  preparedSkipList: PreparedSkipList
): SharedExternalsConfig | null {
  let exclude: string[] = [];

  let resolveGlob = false;
  if (typeof includeSecondaries === 'object') {
    if (includeSecondaries.skip) {
      if (Array.isArray(includeSecondaries.skip)) {
        exclude = includeSecondaries.skip;
      } else if (typeof includeSecondaries.skip === 'string') {
        exclude = [includeSecondaries.skip];
      }
    }

    resolveGlob = !!includeSecondaries.resolveGlob;
  }

  if (!io.exists(libPath)) {
    return {};
  }

  const configured = readConfiguredSecondaries(
    io,
    key,
    libPath,
    exclude,
    shareObject,
    preparedSkipList,
    resolveGlob
  );
  if (configured) {
    return configured;
  }

  // Fallback: Search folders
  const secondaries = findSecondaries(io, libPath, exclude, shareObject, preparedSkipList);
  return secondaries;
}

function readConfiguredSecondaries(
  io: FileReaderPort & GlobPort,
  parent: string,
  libPath: string,
  exclude: string[],
  shareObject: ExternalConfig,
  preparedSkipList: PreparedSkipList,
  resolveGlob: boolean
): SharedExternalsConfig | null {
  const libPackageJson = path.join(libPath, 'package.json');

  if (!io.exists(libPackageJson)) {
    return null;
  }

  const packageJson = JSON.parse(io.readText(libPackageJson));

  const version = packageJson['version'] as string;
  const esm = packageJson['type'] === 'module';

  const exports = packageJson['exports'] as Record<string, Record<string, string>>;

  if (!exports) {
    return null;
  }

  const keys = Object.keys(exports).filter(
    key =>
      key !== '.' &&
      key !== './package.json' &&
      key.startsWith('./') &&
      (exports[key]?.['default'] || exports[key]?.['import'] || typeof exports[key] === 'string')
  );

  const result = {} as SharedExternalsConfig;
  const discoveredFiles = new Set<string>();

  for (const key of keys) {
    const secondaryName = path.join(parent, key).replace(/\\/g, '/');

    const inCustomSkipList = exclude.some(
      e => e === secondaryName || (e.endsWith('*') && secondaryName.startsWith(e.slice(0, -1)))
    );
    if (inCustomSkipList) continue;

    if (isInSkipList(secondaryName, preparedSkipList)) {
      continue;
    }

    const entry = getDefaultEntry(exports, key);

    if (typeof entry !== 'string') {
      logger.warn('No entry point found for ' + secondaryName);
      continue;
    }

    if (!key.includes('*') && !isJsFile(entry)) {
      continue;
    }

    const items = resolveGlobSecondaries(
      io,
      key,
      libPath,
      parent,
      secondaryName,
      entry,
      { discovered: discoveredFiles, skip: exclude },
      resolveGlob
    );
    items.forEach(e => discoveredFiles.add(typeof e === 'string' ? e : e.value));

    for (const item of items) {
      if (typeof item === 'object') {
        result[item.key] = {
          ...shareObject,
          packageInfo: {
            entryPoint: item.value,
            version: shareObject.version ?? version,
            esm,
          },
        };
      } else {
        result[item] = {
          ...shareObject,
        };
      }
    }
  }

  return result;
}

function resolveGlobSecondaries(
  io: GlobPort,
  key: string,
  libPath: string,
  parent: string,
  secondaryName: string,
  entry: string,
  excludes: { discovered: Set<string>; skip: string[] },
  resolveGlob: boolean
): Array<string | KeyValuePair> {
  let items: Array<string | KeyValuePair> = [];
  if (key.includes('*')) {
    if (!resolveGlob) return items;
    const expanded = resolvePackageJsonExportsWildcardCore(io, key, entry, libPath);
    items = expanded
      .map(e => ({
        key: path.join(parent, e.key),
        value: path.join(libPath, e.value),
      }))
      .filter(i => {
        if (!isJsFile(i.value)) {
          return false;
        }
        if (
          excludes.skip.some(e =>
            e.endsWith('*') ? i.key.startsWith(e.slice(0, -1)) : e === i.key
          )
        ) {
          return false;
        }
        if (excludes.discovered.has(i.value)) {
          return false;
        }
        return true;
      });
  } else {
    items = [secondaryName];
  }
  return items;
}

function isJsFile(file: string): boolean {
  return file.endsWith('.js') || file.endsWith('.mjs') || file.endsWith('.cjs');
}

function getDefaultEntry(exports: Record<string, Record<string, string>>, key: string) {
  let entry: string | undefined = '';
  if (typeof exports[key] === 'string') {
    entry = exports[key] as unknown as string;
  }

  if (!entry) {
    entry = exports[key]?.['default'];
    if (typeof entry === 'object') {
      entry = entry['default'];
    }
  }

  if (!entry) {
    entry = exports[key]?.['import'];
    if (typeof entry === 'object') {
      entry = entry['import'] ?? entry['default'];
    }
  }

  if (!entry) {
    entry = exports[key]?.['require'];
    if (typeof entry === 'object') {
      entry = entry['require'] ?? entry['default'];
    }
  }

  return entry;
}

export function addSecondaries(
  secondaries: Record<string, ExternalConfig>,
  result: Record<string, ExternalConfig>
) {
  for (const key in secondaries) {
    result[key] = secondaries[key]!;
  }
}
