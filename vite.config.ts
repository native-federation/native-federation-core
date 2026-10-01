import { defineConfig } from 'vite';

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: 'node_modules/.vite',
  // TS_FLOOR=1 runs the suite against the lowest typescript the dependency range admits.
  resolve: process.env['TS_FLOOR'] ? { alias: { typescript: 'typescript-floor' } } : {},
  test: {
    name: 'core',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: 'coverage',
      provider: 'v8' as const,
    },
  },
}));
