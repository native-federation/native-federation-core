export type IncludeSecondariesOptions =
  { skip?: string | string[]; resolveGlob?: boolean; keepAll?: boolean } | boolean;

export interface AutoRequiredOptions {
  /** Explicitly indicates auto-resolution. */ 
  mode?: 'auto';
  /** Prefix to prepend to the resolved package.json value (e.g. 'v', '^', '~', ''). */
  prefix?: string;
  /** When true, strip existing range/prefix characters and replace with prefix. */
  force?: boolean;
}

export interface ExternalConfig {
  singleton?: boolean;
  strictVersion?: boolean;
  /**
   * Either a concrete required range string (e.g. '^1.2.3') or an AutoRequiredOptions
   * object to resolve the value from package.json with optional prefix/force behaviour.
   */
  requiredVersion?: string | AutoRequiredOptions;
  version?: string;
  includeSecondaries?: IncludeSecondariesOptions;
  platform?: 'browser' | 'node';
  build?: 'separate' | 'package';
  pool?: string;
  chunks?: boolean;
  shareScope?: string;
  packageInfo?: {
    entryPoint: string;
    version?: string;
    esm?: boolean;
  };
}

export interface NormalizedExternalConfig {
  singleton: boolean;
  strictVersion: boolean;
  requiredVersion: string;
  version?: string;
  includeSecondaries?: boolean;
  shareScope?: string;
  pool?: string;
  chunks: boolean;
  platform: 'browser' | 'node';
  build: 'default' | 'separate' | 'package';
  packageInfo?: {
    entryPoint: string;
    version: string;
    esm: boolean;
  };
}

export type SharedExternalsConfig = Record<string, ExternalConfig>;

export type NormalizedSharedExternalsConfig = Record<string, NormalizedExternalConfig>;

export type ShareAllExternalsOptions = ExternalConfig;

export type ShareExternalsOptions = SharedExternalsConfig;

export type ResolvedExternalConfig = Omit<ExternalConfig, 'includeSecondaries'> & {
  includeSecondaries?: boolean;
};

export type ResolvedSharedExternalsConfig = Record<string, ResolvedExternalConfig>;
