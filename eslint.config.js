import js from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

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
    },
  },

  // Prettier configuration (disable conflicting rules)
  prettierConfig,
];
