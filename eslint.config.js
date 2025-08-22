import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import noBarrelFiles from 'eslint-plugin-no-barrel-files';

export default [
  // Global ignores
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/*.d.ts'],
  },

  // Base configuration for TypeScript files
  {
    files: ['**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.es2022,
      },
      ecmaVersion: 2022,
      sourceType: 'module',
      parser: tseslint.parser,
    },
    plugins: {
      'no-barrel-files': noBarrelFiles,
    },
  },

  // ESLint recommended rules
  js.configs.recommended,

  // TypeScript configuration
  ...tseslint.configs.recommended,

  // TypeScript rules for all .ts files
  {
    files: ['**/*.ts'],
    rules: {
      // Prefer type over interface
      '@typescript-eslint/consistent-type-definitions': ['error', 'type'],

      // Ensure imports are used
      '@typescript-eslint/no-unused-vars': 'error',

      // No any types
      '@typescript-eslint/no-explicit-any': 'error',

      // General rules
      'prefer-const': 'error',
      'no-var': 'error',

      // No barrel files
      'no-barrel-files/no-barrel-files': 'error',
    },
  },
  // Test files configuration
  {
    files: ['**/*.{test,spec}.{ts,tsx}', '**/e2e/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
    },
  },
];
