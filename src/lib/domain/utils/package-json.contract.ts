export interface PackageInfo {
  packageName: string;
  entryPoint: string;
  version: string;
  esm: boolean;
}

export interface PartialPackageJson {
  module: string;
  main: string;
}

export type VersionMap = Record<string, string>;

export type PackageJsonInfo = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  content: any;
  directory: string;
};

// Reads and caches `package.json` files; the cache is per-instance.
export interface PackageJsonRepository {
  /** package.json files between `project` and `workspace`, nearest first. */
  getPackageJsonFiles(project: string, workspace: string): PackageJsonInfo[];
  /** Nearest `node_modules/<pkg>/package.json` walking up from `projectRoot`. */
  findDepPackageJson(packageName: string, projectRoot: string): string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readJson(filePath: string): any;
  exists(filePath: string): boolean;
}

export type ExportCondition =
  | 'import'
  | 'require'
  | 'node'
  | 'cjs'
  | 'esm'
  | 'default'
  | 'types'
  | 'browser'
  | (string & {});

export type ExportEntry =
  | string
  | undefined
  | { [key in ExportCondition]?: ExportEntry }
  | ExportEntry[];
