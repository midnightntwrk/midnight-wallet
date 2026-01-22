import esLint from '@eslint/js';
import tsLint from 'typescript-eslint';
import esLintPrettier from 'eslint-plugin-prettier/recommended';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { includeIgnoreFile } from '@eslint/compat';

export const packageConfig = (...cfgs) => {
  const defaultFiles = ['src/**/*.{ts,tsx}', 'test/**/*.{ts,tsx}', 'scripts/**/*.ts'];
  return [
    ...defaultConfig.map((config) => ({ ...config, files: defaultFiles })),
    globalIgnores,
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

//TODO: consider defining config for config JS files too (for consistent formatting at the very least)
export const defaultConfig = tsLint.config(
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
