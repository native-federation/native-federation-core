import Module from 'node:module';

// Vite's alias only rewrites ESM imports. sheriff is CommonJS, so its require('typescript') would
// still load the hoisted copy; redirect CJS resolution in this worker too.
type Resolve = (request: string, ...rest: unknown[]) => string;
const mod = Module as unknown as { _resolveFilename: Resolve };
const resolve = mod._resolveFilename;
mod._resolveFilename = (request, ...rest) =>
  resolve(request === 'typescript' ? 'typescript-floor' : request, ...rest);
