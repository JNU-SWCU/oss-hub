import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import { sharedConfig } from '../../eslint.shared.mjs';
import frontendConfig from './eslint.config.mjs';

export default defineConfig([
  ...frontendConfig.filter(
    (config) => config.ignores && Object.keys(config).length === 1,
  ),
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    extends: [...sharedConfig, prettier],
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['vitest.config.mts'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
]);
