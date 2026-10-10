import tseslint from 'typescript-eslint';
import noComments from './eslint-rules/no-comments.mjs';

const noCommentsPlugin = {
  rules: { 'no-comments': noComments },
};

export const typeCheckedConfig = tseslint.configs.recommendedTypeChecked;

export const sharedConfig = [
  ...typeCheckedConfig,
  {
    plugins: { local: noCommentsPlugin },
    linterOptions: { noInlineConfig: true },
    rules: { 'local/no-comments': 'error' },
  },
];
