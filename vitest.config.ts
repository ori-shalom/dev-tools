import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Test file patterns
    include: ['**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/coverage/**'],

    // Enable parallel execution
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: false,
      },
    },

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: ['coverage/**', 'dist/**', '**/*.d.ts', '**/*.test.ts', '**/*.config.*', 'node_modules/**'],
      // High coverage thresholds based on current achievement
      thresholds: {
        global: {
          branches: 90,
          functions: 85,
          lines: 90,
          statements: 90,
        },
      },
    },

    // Test environment
    environment: 'node',

    // Global test timeout
    testTimeout: 30000,

    // Setup files if needed
    // setupFiles: ['./test-setup.ts'],
  },
});
