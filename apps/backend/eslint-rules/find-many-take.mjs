const BOUNDED_METHODS = new Set(['findMany', 'groupBy']);

const keyOf = (node) =>
  node.computed
    ? node.property.type === 'Literal'
      ? node.property.value
      : undefined
    : (node.property.name ?? node.property.value);

const isUndefined = (value) =>
  value?.type === 'Identifier' && value.name === 'undefined';

const hasTake = (argument) =>
  argument?.type === 'ObjectExpression' &&
  argument.properties.some(
    (property) =>
      property.type === 'Property' &&
      !property.computed &&
      (property.key.name ?? property.key.value) === 'take' &&
      !isUndefined(property.value),
  );

export const findManyTake = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      missingTake:
        '{{method}}에 take가 없다. 상한(CAP + 1), 페이지 크기, 커서 배치 크기 중 하나로 take를 지정한다.',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== 'MemberExpression') return;
        const method = keyOf(callee);
        if (!BOUNDED_METHODS.has(method)) return;
        if (!hasTake(node.arguments[0]))
          context.report({ node, messageId: 'missingTake', data: { method } });
      },
    };
  },
};
