import tseslint from 'typescript-eslint';
import noComments from './eslint-rules/no-comments.mjs';

const noCommentsPlugin = {
  rules: { 'no-comments': noComments },
};

export const sharedConfig = [
  ...tseslint.configs.recommendedTypeChecked,
  {
    plugins: { local: noCommentsPlugin },
    linterOptions: { noInlineConfig: true },
    rules: { 'local/no-comments': 'error' },
  },
];
