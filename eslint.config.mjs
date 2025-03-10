import esLint from '@eslint/js';
import tsLint from 'typescript-eslint';
import esLintPrettier from 'eslint-plugin-prettier/recommended';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export default tsLint.config(
  esLint.configs.recommended,
  ...tsLint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: dirname(fileURLToPath(import.meta.url))
      }
    },
    rules: {
      'max-len': [ 'warn', { 'code': 120, 'tabWidth': 2 } ],
      'eol-last': [ 'error', 'always' ],
      'brace-style': [ 'error', 'stroustrup' ],
      'no-console': 'warn',
      'no-unused-vars': 'off',
      'object-curly-newline': [
        'error',
        {
          'ObjectExpression': { 'consistent': true },
          'ObjectPattern': { 'consistent': true }
        }
      ],
      'object-curly-spacing': ['error', 'always'],
      'no-trailing-spaces': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        // Ensure that discards (i.e., _, __) don't trigger this rule.
        {
          'argsIgnorePattern': '^_',
          'destructuredArrayIgnorePattern': '^_',
          'varsIgnorePattern': '^_'
        }
      ]
    }
  },
  esLintPrettier
);
