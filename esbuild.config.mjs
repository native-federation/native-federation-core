import { build } from 'esbuild';
import fg from 'fast-glob';

// Raw esbuild build for @softarc/native-federation.
//
// Each source file is transpiled 1:1 (bundle: false) so the published module
// graph mirrors the source layout and keeps its explicit `./*.js` import
// specifiers intact. Type declarations are emitted separately by
// `tsc -p tsconfig.build.json` (esbuild does not generate `.d.ts`).
const entryPoints = await fg('src/**/*.ts', {
  ignore: ['src/**/*.spec.ts', 'src/**/*.test.ts', 'src/**/__test-helpers__/**'],
});

await build({
  entryPoints,
  outdir: 'dist',
  outbase: 'src',
  bundle: false,
  format: 'esm',
  platform: 'node',
  target: 'esnext',
  logLevel: 'info',
});
