import { type BuildAdapterOptions, getBuildAdapter } from '../core/build-adapter.js';

export async function bundle(options: BuildAdapterOptions) {
  const adapter = getBuildAdapter();
  return await adapter(options);
}
