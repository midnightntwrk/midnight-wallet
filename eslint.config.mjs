import esLint from '@eslint/js';
import tsLint from 'typescript-eslint';
import esLintPrettier from 'eslint-plugin-prettier/recommended';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { includeIgnoreFile } from '@eslint/compat';
import { defineConfig } from 'eslint/config';

export const packageConfig = (...cfgs) => {
  const defaultFiles = ['src/**/*.{ts,tsx}', 'test/**/*.{ts,tsx}', 'scripts/**/*.ts'];
  return [
    ...defaultConfig.map((config) => ({ ...config, files: defaultFiles })),
    globalIgnores,
    walletApiContracts,
    ...cfgs.map((cfg) => {
      const containsRules = cfg?.rules !== undefined;
      return containsRules ? { ...cfg, files: cfg.files ?? defaultFiles } : cfg;
    }),
  ];
};

const globalIgnores = includeIgnoreFile(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '.gitignore'),
  'From gitignore',
);

// A wallet package's API is fulfilled by its variants on both sides of a protocol boundary, so it names neither ledger
// version: a type from one would describe only that side. Nor does it reach into a variant's tree, whose types are
// stated in that variant's ledger version. The variants import the API's types and the capability contracts they
// share from `src/types`, not the other way round.
const walletApiContracts = {
  files: ['src/*WalletAPI.ts', 'src/types/**/*.ts'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['@midnight-ntwrk/ledger-*', '@midnightntwrk/ledger-*'],
            message: "A wallet API spans both ledger versions: use an SDK-owned type, not one ledger version's.",
          },
          {
            group: ['./v1/*', './v2/*', '../v1/*', '../v2/*'],
            message: 'A wallet API spans both variants: declare the type here, and have the variants use it.',
          },
        ],
      },
    ],
  },
};

//TODO: consider defining config for config JS files too (for consistent formatting at the very least)
export const defaultConfig = defineConfig(
  esLint.configs.recommended,
  ...tsLint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: path.dirname(fileURLToPath(import.meta.url)),
      },
    },
    rules: {
      'max-len': ['warn', { code: 120, tabWidth: 2 }],
      'eol-last': ['error', 'always'],
      'brace-style': ['error', 'stroustrup'],
      'no-console': 'warn',
      // A comment must stand on its own for a reader with only the file open. One that cites a review, reviewer or PR
      // thread as its justification carries context nobody can recover later — that history lives in the commit
      // message and the PR. Backstop for `.claude/rules/code-review.md`.
      'no-warning-comments': [
        'error',
        {
          terms: ['reviewer', 'review finding', 'review comment', 'per review', 'as discussed', 'addresses comment'],
          location: 'anywhere',
        },
      ],
      'no-unused-vars': 'off',
      'object-curly-newline': [
        'error',
        {
          ObjectExpression: { consistent: true },
          ObjectPattern: { consistent: true },
        },
      ],
      'object-curly-spacing': ['error', 'always'],
      'no-trailing-spaces': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        // Ensure that discards (i.e., _, __) don't trigger this rule.
        {
          argsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/consistent-type-imports': ['warn', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-namespace': [
        'error',
        // Ensure that we allow namespace declarations to support Effect style typing.
        {
          allowDeclarations: true,
        },
      ],
    },
  },
  esLintPrettier,
);

export default packageConfig();
