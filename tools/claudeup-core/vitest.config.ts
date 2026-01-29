import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'src/__tests__/unit/**/*.test.ts',
      'src/__tests__/integration/**/*.test.ts',
    ],
    exclude: ['node_modules', 'dist'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      reportsDirectory: './coverage',
      include: [
        'src/utils/**/*.ts',
        'src/services/**/*.ts',
      ],
      exclude: [
        'src/__tests__/**',
        'src/types/**',
        'src/data/**',
        '**/*.d.ts',
      ],
    },
    testTimeout: 10000,
    // Reporter for CI
    reporters: process.env.CI ? ['junit', 'default'] : ['default'],
    outputFile: {
      junit: './test-results/junit.xml',
    },
  },
  resolve: {
    alias: {
      '@fixtures': resolve(__dirname, 'src/__tests__/fixtures'),
      '@utils': resolve(__dirname, 'src/__tests__/utils'),
    },
  },
});
