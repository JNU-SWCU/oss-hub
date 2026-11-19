import { findManyTake } from './find-many-take.mjs';
import { nestedRelationTake } from './nested-relation-take.mjs';
import { noQueryRuleDisable } from './no-query-rule-disable.mjs';
import { rawSelectLimit } from './raw-select-limit.mjs';
import { testFiles } from './rails-config.mjs';

export const queryRuleBlocks = [
  {
    files: ['src/**/*.ts'],
    ignores: testFiles,
    plugins: {
      prisma: {
        rules: {
          'find-many-take': findManyTake,
          'nested-relation-take': nestedRelationTake,
          'raw-select-limit': rawSelectLimit,
        },
      },
      sequential: {
        rules: {
          'no-query-rule-disable': noQueryRuleDisable,
        },
      },
    },
    rules: {
      'no-await-in-loop': 'error',
      'prisma/find-many-take': 'error',
      'prisma/nested-relation-take': 'error',
      'prisma/raw-select-limit': 'error',
      'sequential/no-query-rule-disable': 'error',
    },
  },
];
