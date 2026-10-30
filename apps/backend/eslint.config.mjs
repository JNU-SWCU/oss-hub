import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { builtinRules } from 'eslint/use-at-your-own-risk';
import { createRailsConfig } from './eslint-rules/rails-config.mjs';
import {
  crossAppImportPatterns,
  noCrossAppPath,
} from './eslint-rules/no-cross-app-path.mjs';
import { sharedConfig } from '../../eslint.shared.mjs';

export default tseslint.config(
  eslint.configs.recommended,
  ...sharedConfig,
  prettier,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  ...(await createRailsConfig(import.meta.dirname)),
  {
    files: ['**/*.{js,mjs,cjs,ts}'],
    plugins: {
      'cross-app': {
        rules: {
          'no-cross-app-path': noCrossAppPath,
          'no-restricted-imports': builtinRules.get('no-restricted-imports'),
        },
      },
    },
    rules: {
      'cross-app/no-cross-app-path': 'error',
      'cross-app/no-restricted-imports': [
        'error',
        { patterns: crossAppImportPatterns },
      ],
    },
  },
  {
    files: ['src/**/dto/*.ts'],
    rules: {
      '@typescript-eslint/naming-convention': [
        'error',
        {
          selector: ['class', 'interface', 'typeAlias'],
          format: ['PascalCase'],
          custom: {
            regex: '^[A-Z][A-Za-z0-9]*(?:Request|Response)Dto$',
            match: true,
          },
        },
      ],
    },
  },
  {
    files: ['eslint.config.mjs', 'eslint-rules/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    ignores: ['dist', 'node_modules'],
  },
);
