export interface ExternalConfig {
  singleton?: boolean;
  strictVersion?: boolean;
  requiredVersion?: string;
  version?: string;
  includeSecondaries?: boolean;
  platform?: 'browser' | 'node';
  build?: 'default' | 'separate';
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
  platform: 'browser' | 'node';
  build: 'default' | 'separate' | 'package';
  packageInfo?: {
    entryPoint: string;
    version: string;
    esm: boolean;
  };
}

export type IncludeSecondariesOptions =
  | { skip: string | string[]; resolveGlob?: boolean; keepAll?: boolean }
  | boolean;

export type SharedExternalsConfig = Record<string, ExternalConfig>;

export type NormalizedSharedExternalsConfig = Record<string, NormalizedExternalConfig>;

export type ShareAllExternalsOptions = ExternalConfig & {
  includeSecondaries?: IncludeSecondariesOptions;
};

export type ShareExternalsOptions = Record<string, ShareAllExternalsOptions>;
