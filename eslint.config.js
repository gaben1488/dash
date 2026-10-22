import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import eslintConfigPrettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.next/**',
      '.claude/**',
      'artifacts/**',
      'docs/superpowers/**',
      'graphify-corpus/**',
      'graphify-out/**',
      'reports/**',
      'scripts/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ['packages/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    files: ['packages/web/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      'react-hooks/exhaustive-deps': 'warn',
      'react-hooks/rules-of-hooks': 'error',
    },
  },
  {
    files: ['packages/web/src/**/*.{ts,tsx}'],
    ignores: ['**/*.test.*', '**/*.spec.*'],
    rules: {
      'no-restricted-syntax': ['error', {
        selector: 'VariableDeclarator[id.name=/(LABELS?|HINTS?|COPY|TITLE|NOTE|MESSAGE|TEXT)$/] ObjectExpression > Property > Literal.value[value=/[А-Яа-яЁё]/]',
        message: 'Экранный словарь принадлежит @aemr/shared/product-dictionary. Используйте общий реестр вместо локальной копии.',
      }],
    },
  },
  eslintConfigPrettier,
);
