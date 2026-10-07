import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', '**/*.cjs'] },
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ['**/*.ts', '**/*.tsx'],
  })),
  prettier,
  {
    // Must stay scoped to the same `files` as the configs above: the
    // @typescript-eslint plugin is only registered on those entries, and flat
    // config requires a plugin to be defined in the same config object that
    // applies its rules. Without `files` this block applies to every file
    // (including .js) and ESLint aborts with
    // "could not find plugin @typescript-eslint".
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
);
