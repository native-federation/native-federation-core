import * as path from 'path';
import * as ts from 'typescript';
import { nodeIo } from '../utils/io/node-io-adapter.js';
import type { FileReaderPort } from '../domain/utils/io-port.contract.js';
import type { PathToImport } from '../domain/utils/mapped-path.contract.js';
import type {
  MappingConfigInput,
  SharedMappingConfigs,
  SharedMappingEntry,
  SharedMappingPackageEntry,
} from '../domain/config/federation-config.contract.js';
import { matchesWildcard } from '../utils/path-patterns.js';
import { formatDifference } from '../utils/format-list.js';

type SelectionEntry = string | [string[], MappingConfigInput];

export interface RawMappedPaths {
  paths: PathToImport;
  configs: SharedMappingConfigs;
  // Every `paths` key, whether selected or not: declarations are checked against all of them.
  keys: string[];
  // Declared package prefix -> its config.
  packages: SharedMappingConfigs;
}

/**
 * Will return user defined and tsconfig defined paths including their imports, might contain wildcards
 */
export function getRawMappedPaths(
  rootTsConfigPath: string,
  configuredSharedMappings?: SharedMappingEntry[],
  rootPath?: string
): RawMappedPaths {
  return getRawMappedPathsCore(nodeIo, rootTsConfigPath, configuredSharedMappings, rootPath);
}

export function getRawMappedPathsCore(
  io: FileReaderPort,
  rootTsConfigPath: string,
  configuredSharedMappings?: SharedMappingEntry[],
  rootPath?: string
): RawMappedPaths {
  const mappedPaths: PathToImport = {};

  if (!path.isAbsolute(rootTsConfigPath)) {
    throw new Error('SharedMappings.register: tsConfigPath needs to be an absolute path!');
  }

  const shareAll = !configuredSharedMappings;
  const { selection, packages } = partitionEntries(configuredSharedMappings ?? []);
  const { patterns, configs } = flattenEntries(selection);

  const { paths: mappings, basePath } = readCompilerPaths(io, rootTsConfigPath);

  if (!mappings) {
    return { paths: mappedPaths, configs, keys: [], packages };
  }

  const base = rootPath ?? basePath;

  for (const key in mappings) {
    // An empty target list is the compile's error to report (TS5066).
    const target = mappings[key]?.[0];
    if (!target) continue;
    const libPath = path.normalize(path.join(base, target));

    if (shareAll || patterns.some(pattern => matchesWildcard(key, pattern))) {
      mappedPaths[libPath] = key;
    }
  }

  return { paths: mappedPaths, configs, keys: Object.keys(mappings), packages };
}

// Resolved like the compile resolves them: through `extends`, against `baseUrl` or else the
// tsconfig that defines `paths` (core#149).
function readCompilerPaths(
  io: FileReaderPort,
  tsConfigPath: string
): { paths?: ts.MapLike<string[]>; basePath: string } {
  const { config, error } = ts.readConfigFile(tsConfigPath, file => readOrUndefined(io, file));
  if (error) {
    throw new Error(
      `Could not parse ${tsConfigPath}: ${ts.flattenDiagnosticMessageText(error.messageText, '\n')}`
    );
  }

  // Only `options` is read; an empty `readDirectory` keeps TypeScript from walking `include`.
  // Option diagnostics are the compile's to report, but a broken `extends` chain would silently
  // drop the inherited `paths`, so those are rethrown.
  const host: ts.ParseConfigHost = {
    useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
    readDirectory: () => [],
    fileExists: file => io.isFile(file),
    readFile: file => readOrUndefined(io, file),
  };
  const { options, errors } = ts.parseJsonConfigFileContent(
    config,
    host,
    path.dirname(tsConfigPath),
    undefined,
    tsConfigPath
  );

  const extendsErrors = errors.filter(e => EXTENDS_DIAGNOSTICS.has(e.code));
  if (extendsErrors.length) {
    const messages = extendsErrors.map(e => ts.flattenDiagnosticMessageText(e.messageText, '\n'));
    throw new Error(
      `Could not resolve the extends chain of ${tsConfigPath}: ${messages.join('; ')}`
    );
  }

  return { paths: options.paths, basePath: path.normalize(pathsBase(options, tsConfigPath)) };
}

// 5083 "Cannot read file" (relative `extends`), 6053 "File not found" (package `extends`).
const EXTENDS_DIAGNOSTICS = new Set([5083, 6053]);

function pathsBase(options: ts.CompilerOptions, tsConfigPath: string): string {
  if (options.baseUrl) return options.baseUrl;
  if (!options.paths) return path.dirname(tsConfigPath);

  // Internal: the directory of the tsconfig that defines `paths`, set by every TypeScript in the
  // dependency range. Guessed wrong, every mapping would point at a missing file without a word.
  const pathsBasePath = options['pathsBasePath'];
  if (typeof pathsBasePath !== 'string') {
    throw new Error(
      `TypeScript ${ts.version} no longer reports where the "paths" of ${tsConfigPath} are ` +
        'defined; set "baseUrl" next to them to work around it.'
    );
  }
  return pathsBasePath;
}

function readOrUndefined(io: FileReaderPort, file: string): string | undefined {
  return io.isFile(file) ? io.readText(file) : undefined;
}

// Declarations select nothing, so they are split off before the selection is flattened.
function partitionEntries(entries: SharedMappingEntry[]): {
  selection: SelectionEntry[];
  packages: SharedMappingConfigs;
} {
  const selection: SelectionEntry[] = [];
  const packages: SharedMappingConfigs = Object.create(null);

  for (const entry of entries) {
    if (typeof entry === 'string' || Array.isArray(entry)) {
      selection.push(entry);
      continue;
    }
    if (!isMappingPackageEntry(entry)) {
      throw new Error(
        `Invalid sharedMappings entry ${JSON.stringify(entry)}: expected a pattern, ` +
          `[patterns, config] or { package: '<prefix>', ...config }.`
      );
    }

    const { package: prefix, ...config } = entry;
    if ((config as MappingConfigInput).build !== undefined) {
      throw new Error(
        `Shared mapping package '${prefix}' sets build, which a declared package does not take: ` +
          `its entry points are always bundled as one package.`
      );
    }
    const seen = packages[prefix];
    const difference = seen && formatDifference(seen, config);
    if (difference) {
      throw new Error(
        `Shared mapping package '${prefix}' is declared twice with different configs ` +
          `(${difference}).`
      );
    }
    packages[prefix] = config;
  }

  return { selection, packages };
}

function isMappingPackageEntry(entry: unknown): entry is SharedMappingPackageEntry {
  return (
    typeof entry === 'object' &&
    entry !== null &&
    typeof (entry as { package?: unknown }).package === 'string'
  );
}

function flattenEntries(entries: SelectionEntry[]): {
  patterns: string[];
  configs: SharedMappingConfigs;
} {
  const patterns: string[] = [];
  // Prototype-free: patterns are user strings, so `in` must not answer for 'toString' & co.
  const configs: SharedMappingConfigs = Object.create(null);

  for (const entry of entries) {
    if (typeof entry === 'string') {
      patterns.push(entry);
      continue;
    }
    const [keys, config] = entry;
    for (const key of keys) {
      patterns.push(key);
      // Declaration order decides: a later entry never overrides an earlier one.
      if (!(key in configs)) configs[key] = config;
    }
  }

  return { patterns, configs };
}
