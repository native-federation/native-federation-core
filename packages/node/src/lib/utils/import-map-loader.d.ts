export const IMPORT_MAP_FILE_NAME = 'node.importmap';

export interface ImportMap {
  imports: Record<string, string | null>;
  scopes: Record<string, Record<string, string | null>>;
}

export interface ResolveContext {
  parentURL?: string | null;
  format?: string;
  [key: string]: unknown;
}

export interface LoadContext {
  format?: string;
  [key: string]: unknown;
}

export interface LoadResult {
  shortCircuit?: boolean;
  format?: string;
  source?: string;
  [key: string]: unknown;
}

export type DefaultResolve = (
  specifier: string,
  context: ResolveContext,
  defaultResolve: DefaultResolve
) => Promise<unknown> | unknown;

export type DefaultLoad = (
  url: string,
  context: LoadContext,
  defaultLoad: DefaultLoad
) => Promise<LoadResult> | LoadResult;

export function resolveSpecifier(
  importMap: ImportMap,
  specifier: string,
  parentURL: string | null
): string | null;

export function resolveAndComposeImportMap(parsed: unknown): ImportMap;

export function resolve(
  specifier: string,
  context: ResolveContext,
  defaultResolve: DefaultResolve
): Promise<unknown>;

export function load(
  url: string,
  context: LoadContext,
  defaultLoad: DefaultLoad
): Promise<LoadResult>;

declare global {
  namespace globalThis {
    let nodeLoader: {
      setImportMapPromise: (promise: Promise<ImportMap | Record<string, unknown>>) => void;
    };
  }
}
