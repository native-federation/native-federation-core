export type IncludeSecondariesOptions =
  { skip?: string | string[]; resolveGlob?: boolean; keepAll?: boolean } | boolean;

export interface AutoRequiredOptions {
  /** Optional mode: 'auto' when omitted. */
  mode?: 'auto' | 'version';
  /** Controls how the resolved package.json version is emitted.
   * - 'exact' => "1.2.3"
   * - '^' | '~' => '^1.2.3' or '~1.2.3'
   * - 'minor' => maps to '^' (allow minor bumps)
   * - 'patch' => maps to '~' (allow patch bumps)
   */
  range?: 'exact' | '^' | '~' | 'minor' | 'patch';
}

export interface ExternalConfig {
  singleton?: boolean;
  strictVersion?: boolean;
  // Version string (e.g. '^1.2.3') or auto-resolve options.
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
