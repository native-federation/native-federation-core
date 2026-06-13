import type { PathToImport } from './mapped-path.contract.js';

export type UsedDependencies = {
  external: Set<string>;
  internal: PathToImport;
};
