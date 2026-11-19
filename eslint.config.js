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
      'apps/web/out/**',
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
      'apps/extension-v1/lib/engine/**/*.ts',
      'apps/extension-v1/entrypoints/*.content.ts',
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
  {
    // The Gator Hack engine, its extension, server and scripts (the engine of
    // record since Nov 2026). Extension APIs are globals there, and TypeScript
    // already checks names, so no-undef only adds false alarms in .ts files.
    files: [
      'packages/engine/**/*.{ts,tsx,js,mjs}',
      'apps/extension/**/*.{ts,tsx,js,mjs}',
      'apps/server/**/*.{ts,tsx,js,mjs}',
      'scripts/engine/**/*.{ts,tsx,js,mjs}',
    ],
    languageOptions: {
      globals: { ...globals.browser, ...globals.webextensions },
    },
  },
  {
    files: [
      'packages/engine/**/*.{ts,tsx}',
      'apps/extension/**/*.{ts,tsx}',
      'apps/server/**/*.{ts,tsx}',
      'scripts/engine/**/*.{ts,tsx}',
    ],
    rules: { 'no-undef': 'off' },
  },
  {
    // These copied Preact files contain suppression comments for a React-only
    // plugin the workspace does not use. Keep source files intact, and lint
    // them with this workspace's configured rules instead of inline directives.
    files: [
      'apps/extension/src/ui/calm/CalmView.tsx',
      'apps/extension/src/ui/lens/Lens.tsx',
      'apps/extension/src/ui/lens/today.ts',
      'apps/extension/src/ui/offers/Note.tsx',
    ],
    linterOptions: { noInlineConfig: true },
  },
  {
    // Deliberate in the ported code: \x00 sentinels and no-break spaces in
    // regexes, escaped brackets, empty catches in probes. Unused names are
    // reported but left as written.
    files: [
      'packages/engine/**/*.{ts,tsx,js,mjs}',
      'apps/extension/**/*.{ts,tsx,js,mjs}',
      'apps/server/**/*.{ts,tsx,js,mjs}',
      'scripts/engine/**/*.{ts,tsx,js,mjs}',
    ],
    rules: {
      'no-control-regex': 'off',
      'no-irregular-whitespace': 'off',
      'no-useless-escape': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'prefer-const': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  prettier,
);
