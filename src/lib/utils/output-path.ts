import * as path from 'path';
import type { FederationOptions } from '../domain/core/federation-options.contract.js';

// resolve, not join: an absolute outputPath must not be nested under workspaceRoot.
export function resolveOutputPath(
  fedOptions: Pick<FederationOptions, 'workspaceRoot' | 'outputPath'>
): string {
  return path.resolve(fedOptions.workspaceRoot, fedOptions.outputPath);
}
