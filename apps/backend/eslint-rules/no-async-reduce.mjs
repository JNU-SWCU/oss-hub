const isAsyncFunction = (node) =>
  (node?.type === 'ArrowFunctionExpression' ||
    node?.type === 'FunctionExpression') &&
  node.async;

export const noAsyncReduce = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      asyncReduce:
        'async reduce 체인은 await-in-loop를 감출 뿐이다. 독립 작업은 Promise.all이나 한 번의 배치 쿼리로, 순서가 필요한 작업은 SequentialRepository.forEach로 쓴다.',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== 'MemberExpression') return;
        const name = callee.computed
          ? callee.property.type === 'Literal'
            ? callee.property.value
            : undefined
          : callee.property.name;
        if (
          (name === 'reduce' || name === 'reduceRight') &&
          isAsyncFunction(node.arguments[0])
        )
          context.report({ node, messageId: 'asyncReduce' });
      },
    };
  },
};
