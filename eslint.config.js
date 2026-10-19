import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.output/**',
      '**/.wxt/**',
      '**/chrome-mv3-dev/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/.next*/**',
      '**/next-env.d.ts',
      'supabase/functions/**',
      'supabase/.temp/**',
      'packages/core/src/db/types.ts',
      'docs/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  {
    files: ['**/*.{js,mjs}'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    rules: {
      // Copy uses no-break spaces on purpose ("18 px" must not wrap).
      'no-irregular-whitespace': [
        'error',
        {
          skipStrings: true,
          skipTemplates: true,
          skipJSXText: true,
          skipComments: true,
        },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    // The in-page engine and Fit view run on every page: no zod, no wire
    // schemas (docs/10 §9). Validation happens in the service worker; types
    // may still be imported.
    files: [
      'apps/extension/lib/engine/**/*.ts',
      'apps/extension/entrypoints/*.content.ts',
    ],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'zod', message: 'No zod in content scripts.' },
            {
              name: '@webable/core',
              allowTypeImports: true,
              message: 'Import values from a zod-free @webable/core subpath.',
            },
          ],
          patterns: [
            {
              group: ['@webable/core/*/wire', '@webable/core/decide/*'],
              allowTypeImports: true,
              message: 'Wire schemas use zod; validate in the service worker.',
            },
          ],
        },
      ],
    },
  },
  prettier,
);
