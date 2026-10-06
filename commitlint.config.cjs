module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'docs', 'refactor', 'style', 'test', 'chore', 'ci'],
    ],

    'subject-case': [0],
  },
};
