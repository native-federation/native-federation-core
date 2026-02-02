import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const testPatterns = ['src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'];
const integrationTestPatterns = ['src/**/*.integration.spec.ts'];

const sharedAlias = {
  '@softarc/native-federation/domain': resolve(__dirname, '../core/dist/src/domain.js'),
  '@softarc/native-federation/internal': resolve(__dirname, '../core/dist/src/internal.js'),
};

export default defineConfig({
  test: {
    globals: true,
    setupFiles: ['src/test-setup.ts'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: './coverage',
      provider: 'v8',
    },
    watch: false,
    pool: 'threads',
    exclude: ['node_modules', 'dist', '.angular'],
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'jsdom',
          include: testPatterns,
          exclude: [...integrationTestPatterns, 'node_modules', 'dist', '.angular'],
        },
      },
      {
        resolve: {
          alias: sharedAlias,
        },

        test: {
          name: 'integration',
          include: integrationTestPatterns,
          browser: {
            enabled: true,
            provider: 'playwright',
            headless: process.env.CI === 'true',
            instances: [
              {
                browser: 'chromium',
              },
            ],
            // Serve static assets for MSW
            api: {
              host: '127.0.0.1',
            },
          },
        },
      },
    ],
  },
});
