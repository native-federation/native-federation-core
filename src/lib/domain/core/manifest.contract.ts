export type FederationManifest = Record<
  string,
  string | { url: string; integrity?: string; main?: string }
>;
