import tseslint from 'typescript-eslint';
import { sharedConfig } from '../eslint.shared.mjs';

export default tseslint.config(
  ...sharedConfig,
  {
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { console: 'readonly', process: 'readonly' },
    },
  },
  {
    files: ['**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
