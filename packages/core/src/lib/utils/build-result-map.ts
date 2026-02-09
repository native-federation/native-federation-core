import path from 'path';
import type { NFBuildAdapterResult } from '../domain/core/build-adapter.contract.js';

export function createBuildResultMap(
  buildResult: NFBuildAdapterResult[],
  isHashed: boolean
): Record<string, string> {
  const map: Record<string, string> = {};

  for (const item of buildResult) {
    const resultName = path.basename(item.fileName);
    let requestName = resultName;
    if (isHashed) {
      const start = resultName.lastIndexOf('-');
      const end = resultName.lastIndexOf('.');
      const part1 = resultName.substring(0, start);
      const part2 = resultName.substring(end);
      requestName = part1 + part2;
    }
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
