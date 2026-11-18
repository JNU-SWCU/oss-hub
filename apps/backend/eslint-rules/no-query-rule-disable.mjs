const GUARDED = /\b(no-await-in-loop|prisma\/[\w-]+|sequential\/[\w-]+)\b/;

export const noQueryRuleDisable = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      disabled: '쿼리 경계 규칙은 끌 수 없다. 코드를 고쳐 규칙을 통과시킨다.',
    },
  },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          if (
            /eslint-disable/.test(comment.value) &&
            GUARDED.test(comment.value)
          )
            context.report({ loc: comment.loc, messageId: 'disabled' });
        }
      },
    };
  },
};
