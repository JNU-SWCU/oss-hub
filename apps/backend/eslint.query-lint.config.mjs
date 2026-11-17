import tseslint from 'typescript-eslint';
import { findManyTake } from './eslint-rules/find-many-take.mjs';
import { testFiles } from './eslint-rules/rails-config.mjs';

export default tseslint.config({
  files: ['src/**/*.ts'],
  ignores: testFiles,
  languageOptions: { parser: tseslint.parser },
  linterOptions: { reportUnusedDisableDirectives: 'off' },
  plugins: { prisma: { rules: { 'find-many-take': findManyTake } } },
  rules: {
    'no-await-in-loop': 'error',
    'prisma/find-many-take': 'error',
  },
});
