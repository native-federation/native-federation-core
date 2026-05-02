export type Imports = Record<string, string>;

export type Scopes = Record<string, Imports>;

export type Integrity = Record<string, string>;

export type ImportMap = {
  imports: Imports;
  scopes: Scopes;
  integrity?: Integrity;
};

export function mergeImportMaps(map1: ImportMap, map2: ImportMap): ImportMap {
  const merged: ImportMap = {
    imports: { ...map1.imports, ...map2.imports },
    scopes: { ...map1.scopes, ...map2.scopes },
  };
  if (map1.integrity || map2.integrity) {
    merged.integrity = { ...(map1.integrity ?? {}), ...(map2.integrity ?? {}) };
  }
  return merged;
}
