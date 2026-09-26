import next from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

/**
 * Flat ESLint config.
 *
 * `android/` is excluded because it is generated Gradle output with its own
 * toolchain, and `.next`/`out` are build artifacts.
 */
const config = [
  {
    ignores: [
      '.next/**',
      'out/**',
      'node_modules/**',
      'android/**',
      'coverage/**',
      'next-env.d.ts',
    ],
  },
  ...next,
  ...nextTypescript,
  {
    rules: {
      // Underscore-prefixed parameters are the documented "intentionally unused" signal.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
    },
  },
];

export default config;
