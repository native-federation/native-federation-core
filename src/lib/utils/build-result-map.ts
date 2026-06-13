import path from 'path';
import type { NFBuildAdapterResult } from '../domain/core/build-adapter.contract.js';

function stripHash(fileName: string): string {
  const start = fileName.lastIndexOf('-');
  const end = fileName.lastIndexOf('.');
  if (start < 0 || end < 0 || start > end) return fileName;
  return fileName.substring(0, start) + fileName.substring(end);
}

export function createBuildResultMap(
  buildResult: NFBuildAdapterResult[],
  isHashed: boolean,
  expectedNames: string[] = []
): Record<string, string> {
  const expected = new Set(expectedNames.map(n => path.basename(n)));
  const map: Record<string, string> = {};

  for (const item of buildResult) {
    const resultName = path.basename(item.fileName);
    const requestName =
      isHashed && expected.has(stripHash(resultName)) ? stripHash(resultName) : resultName;
    map[requestName] = item.fileName;
  }
  return map;
}

export function lookupInResultMap(map: Record<string, string>, requestName: string): string {
  const key = path.basename(requestName);

  // path.basename is to maintain backwards compatible
  return path.basename(map[key]!);
}

export function popFromResultMap(map: Record<string, string>, requestName: string): string {
  const key = path.basename(requestName);
  const out = map[key]!;
  delete map[key];
  return out;
}
