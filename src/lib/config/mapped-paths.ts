import * as path from 'path';
import * as ts from 'typescript';
import { nodeIo } from '../utils/io/node-io-adapter.js';
import type { FileReaderPort } from '../domain/utils/io-port.contract.js';
import type { PathToImport } from '../domain/utils/mapped-path.contract.js';
import type {
  SharedMappingConfigs,
  SharedMappingEntry,
} from '../domain/config/federation-config.contract.js';
import { matchesWildcard } from '../utils/path-patterns.js';

export interface RawMappedPaths {
  paths: PathToImport;
  configs: SharedMappingConfigs;
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
  const { patterns, configs } = flattenEntries(configuredSharedMappings ?? []);

  const { paths: mappings, basePath } = readCompilerPaths(io, rootTsConfigPath);

  if (!mappings) {
    return { paths: mappedPaths, configs };
  }

  const base = rootPath ?? basePath;

  for (const key in mappings) {
    const libPath = path.normalize(path.join(base, mappings[key]![0]!));

    if (shareAll || patterns.some(pattern => matchesWildcard(key, pattern))) {
      mappedPaths[libPath] = key;
    }
  }

  return { paths: mappedPaths, configs };
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
  // Option diagnostics are the compile's to report, so they are not rethrown here.
  const host: ts.ParseConfigHost = {
    useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
    readDirectory: () => [],
    fileExists: file => io.isFile(file),
    readFile: file => readOrUndefined(io, file),
  };
  const { options } = ts.parseJsonConfigFileContent(
    config,
    host,
    path.dirname(tsConfigPath),
    undefined,
    tsConfigPath
  );

  return {
    paths: options.paths,
    basePath: path.normalize(
      options.baseUrl ??
        (options['pathsBasePath'] as string | undefined) ??
        path.dirname(tsConfigPath)
    ),
  };
}

function readOrUndefined(io: FileReaderPort, file: string): string | undefined {
  return io.isFile(file) ? io.readText(file) : undefined;
}

function flattenEntries(entries: SharedMappingEntry[]): {
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
