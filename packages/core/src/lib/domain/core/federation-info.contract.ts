export interface FederationInfo {
  name: string;
  exposes: ExposesInfo[];
  shared: SharedInfo[];
  buildNotificationsEndpoint?: string;
}
export type SharedInfo = {
  singleton: boolean;
  strictVersion: boolean;
  requiredVersion: string;
  version?: string;
  packageName: string;
  shareScope?: string;
  outFileName: string;
  dev?: {
    entryPoint: string;
  };
};
export interface ExposesInfo {
  key: string;
  outFileName: string;
  dev?: {
    entryPoint: string;
  };
}

export interface ArtefactInfo {
  mappings: SharedInfo[];
  exposes: ExposesInfo[];
}
