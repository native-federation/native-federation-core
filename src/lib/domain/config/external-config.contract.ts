export type IncludeSecondariesOptions =
  | { skip?: string | string[]; resolveGlob?: boolean; keepAll?: boolean }
  | boolean;

export interface ExternalConfig {
  singleton?: boolean;
  strictVersion?: boolean;
  requiredVersion?: string;
  version?: string;
  includeSecondaries?: IncludeSecondariesOptions;
  platform?: 'browser' | 'node';
  build?: 'separate' | 'package';
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
