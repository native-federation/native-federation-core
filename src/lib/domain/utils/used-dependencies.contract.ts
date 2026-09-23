import type { PathToImport } from './mapped-path.contract.js';

export type UsedDependencies = {
  external: Set<string>;
  internal: PathToImport;
  // Bare specifiers imported from inside a mapping, each with the first file that imports it.
  mappingImports?: ReadonlyMap<string, string>;
};
