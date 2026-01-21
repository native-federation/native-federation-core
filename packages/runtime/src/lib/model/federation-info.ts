export interface InitFederationOptions {
  cacheTag?: string;
}

export interface ProcessRemoteInfoOptions extends InitFederationOptions {
  throwIfRemoteNotFound: boolean;
}
