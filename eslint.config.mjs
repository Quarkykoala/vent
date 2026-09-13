// Independent lint analysis for the Vent workspace (replaces the previous
// `lint = tsc --noEmit` duplication). Typechecking remains a separate gate.
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/next-env.d.ts',
      '**/coverage/**',
      '**/build/**',
      '**/test-results/**',
      '**/playwright-report/**',
      'logs/**',
      'output/**',
      'audit-context/**',
      'knowledge/**',
      '.commandcode/**',
      '.codex-harness/**',
      'supabase/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      eqeqeq: ['error', 'smart'],
      'no-fallthrough': 'error',
      'no-unreachable': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Existing route/repository code still contains `any` casts. Recorded as
      // a tracked follow-up in docs/execution/GLM_COMPLETION_MATRIX.md (P0.1b):
      // tighten to 'error' package by package.
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
);
