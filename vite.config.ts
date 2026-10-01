import { defineConfig } from 'vite';

const floor = !!process.env['TS_FLOOR'];

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: 'node_modules/.vite',
  // TS_FLOOR=1 runs the suite against the lowest typescript the dependency range admits.
  resolve: floor ? { alias: { typescript: 'typescript-floor' } } : {},
  test: {
    name: 'core',
    watch: false,
    setupFiles: floor ? ['./ts-floor.setup.ts'] : [],
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
