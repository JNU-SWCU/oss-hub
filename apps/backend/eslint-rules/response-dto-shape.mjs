function returnStatements(node) {
  if (!node || typeof node.type !== 'string') return [];
  if (node.type === 'ReturnStatement') return [node];
  if (/Function/.test(node.type) || node.type === 'ClassBody') return [];
  return Object.entries(node).flatMap(([key, value]) =>
    key === 'parent' || typeof value !== 'object' || value === null
      ? []
      : [value].flat().flatMap(returnStatements),
  );
}

function objectSpreads(node) {
  if (!node || typeof node.type !== 'string') return [];
  const own =
    node.type === 'SpreadElement' && node.parent?.type === 'ObjectExpression'
      ? [node]
      : [];
  return own.concat(
    Object.entries(node).flatMap(([key, value]) =>
      key === 'parent' || typeof value !== 'object' || value === null
        ? []
        : [value].flat().flatMap(objectSpreads),
    ),
  );
}

function isFrom(member) {
  return (
    member.type === 'MethodDefinition' &&
    member.static &&
    member.key.type === 'Identifier' &&
    member.key.name === 'from'
  );
}

function returnsClass(method, className) {
  const annotation = method.value.returnType?.typeAnnotation;
  return (
    annotation?.type === 'TSTypeReference' &&
    annotation.typeName.type === 'Identifier' &&
    annotation.typeName.name === className
  );
}

export const responseDtoShape = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      constructor: 'Response DTO에는 생성자를 두지 않는다.',
      field: 'Response DTO 인스턴스 필드는 declare readonly로만 선언한다.',
      method: 'Response DTO에는 인스턴스 메서드를 두지 않는다.',
      from: 'Response DTO에는 static from을 정확히 하나 둔다.',
      fromType: 'static from은 클래스 타입을 반환 타입으로 명시한다.',
      fromBody: 'static from은 객체 리터럴만 return한다.',
      fromSpread: 'static from은 객체 spread 없이 선언 필드를 하나씩 나열한다.',
    },
  },
  create(context) {
    return {
      ClassDeclaration(node) {
        const froms = node.body.body.filter(isFrom);
        if (froms.length !== 1) {
          context.report({ node: node.id, messageId: 'from' });
        }
        for (const member of node.body.body) {
          if (member.type === 'MethodDefinition') {
            if (member.kind === 'constructor') {
              context.report({ node: member, messageId: 'constructor' });
            } else if (!member.static) {
              context.report({ node: member, messageId: 'method' });
            }
          } else if (
            member.type === 'PropertyDefinition' &&
            !member.static &&
            !(member.declare && member.readonly)
          ) {
            context.report({ node: member, messageId: 'field' });
          }
        }
        for (const from of froms) {
          if (!returnsClass(from, node.id.name)) {
            context.report({ node: from, messageId: 'fromType' });
          }
          const returns = returnStatements(from.value.body);
          if (
            returns.length === 0 ||
            returns.some(
              (statement) => statement.argument?.type !== 'ObjectExpression',
            )
          ) {
            context.report({ node: from, messageId: 'fromBody' });
          }
          for (const spread of objectSpreads(from.value.body)) {
            context.report({ node: spread, messageId: 'fromSpread' });
          }
        }
      },
    };
  },
};
