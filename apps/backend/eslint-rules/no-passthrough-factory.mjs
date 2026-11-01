const forwardedConstruction = (factory) => {
  if (
    factory.type !== 'ArrowFunctionExpression' &&
    factory.type !== 'FunctionExpression'
  )
    return null;
  const body =
    factory.body.type === 'BlockStatement' &&
    factory.body.body.length === 1 &&
    factory.body.body[0].type === 'ReturnStatement'
      ? factory.body.body[0].argument
      : factory.body;
  if (body?.type !== 'NewExpression') return null;
  const params = factory.params.map((param) =>
    param.type === 'Identifier' ? param.name : null,
  );
  const forwards =
    params.every((name) => name !== null) &&
    body.arguments.length === params.length &&
    body.arguments.every(
      (argument, index) =>
        argument.type === 'Identifier' && argument.name === params[index],
    );
  return forwards ? body : null;
};

const constructorArity = (checker, services, construction) => {
  const type = checker.getTypeAtLocation(
    services.esTreeNodeToTSNodeMap.get(construction.callee),
  );
  const signatures = type.getConstructSignatures();
  if (signatures.length !== 1) return null;
  return signatures[0].getParameters().length;
};

export const noPassthroughFactory = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      passThrough:
        '생성자 인자를 모두 주입받아 그대로 넘기는 useFactory는 쓰지 않는다. 클래스 provider로 등록한다.',
    },
  },
  create(context) {
    const { parserServices } = context.sourceCode;
    if (!parserServices?.program) {
      throw new Error(
        'no-passthrough-factory는 타입 정보(parserOptions.projectService)가 필요하다.',
      );
    }
    const checker = parserServices.program.getTypeChecker();
    return {
      'Property[key.name="useFactory"]'(node) {
        const construction = forwardedConstruction(node.value);
        if (
          construction &&
          constructorArity(checker, parserServices, construction) ===
            construction.arguments.length
        )
          context.report({ node: node.value, messageId: 'passThrough' });
      },
    };
  },
};
