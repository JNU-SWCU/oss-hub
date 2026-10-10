import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { createRailsConfig } from './eslint-rules/rails-config.mjs';
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
    files: [
      'src/github/collection-sync.service.100-repositories.integration.spec.ts',
    ],
    rules: { '@typescript-eslint/unbound-method': 'off' },
  },
  {
    ignores: ['dist', 'node_modules'],
  },
);
