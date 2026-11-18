import tseslint from 'typescript-eslint';
import { queryRuleBlocks } from './eslint-rules/query-rules.config.mjs';

export default tseslint.config(
  {
    files: ['src/**/*.ts'],
    languageOptions: { parser: tseslint.parser },
    linterOptions: { noInlineConfig: true },
  },
  ...queryRuleBlocks,
);
