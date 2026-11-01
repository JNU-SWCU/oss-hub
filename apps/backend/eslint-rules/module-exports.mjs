const TYPE_WRAPPERS = new Set([
  'TSAsExpression',
  'TSSatisfiesExpression',
  'TSNonNullExpression',
  'TSTypeAssertion',
]);

function unwrap(expression) {
  let current = expression;
  while (current && TYPE_WRAPPERS.has(current.type))
    current = current.expression;
  return current;
}

function isFunctionValue(init) {
  const value = unwrap(init);
  return (
    value?.type === 'ArrowFunctionExpression' ||
    value?.type === 'FunctionExpression'
  );
}

function isFunctionBinding(context, node, name, seen = new Set()) {
  if (seen.has(name)) return false;
  seen.add(name);
  let scope = context.sourceCode.getScope(node);
  while (scope && !scope.set.has(name)) scope = scope.upper;
  const definition = scope?.set.get(name)?.defs[0];
  if (!definition) return false;
  if (definition.type === 'FunctionName') return true;
  if (definition.type === 'ImportBinding')
    return (
      definition.parent.importKind !== 'type' &&
      definition.node.importKind !== 'type'
    );
  if (definition.type !== 'Variable') return false;
  const init = unwrap(definition.node.init);
  if (init?.type === 'Identifier')
    return isFunctionBinding(context, definition.node, init.name, seen);
  return isFunctionValue(init);
}

function exportedFunctionRule(message, isAllowed) {
  return {
    meta: {
      type: 'problem',
      schema: [],
      messages: { forbidden: message },
    },
    create(context) {
      const check = (node, name) => {
        if (!isAllowed(name)) context.report({ node, messageId: 'forbidden' });
      };
      return {
        ExportAllDeclaration(node) {
          if (node.exportKind !== 'type') check(node, '');
        },
        ExportDefaultDeclaration(node) {
          const declaration = unwrap(node.declaration);
          if (
            declaration.type === 'FunctionDeclaration' ||
            isFunctionValue(declaration)
          ) {
            check(node, declaration.id?.name ?? '');
            return;
          }
          if (
            declaration.type === 'Identifier' &&
            isFunctionBinding(context, node, declaration.name)
          )
            check(node, declaration.name);
        },
        ExportNamedDeclaration(node) {
          if (node.exportKind === 'type') return;
          const { declaration } = node;
          if (declaration?.type === 'FunctionDeclaration') {
            check(node, declaration.id.name);
            return;
          }
          if (declaration?.type === 'VariableDeclaration') {
            for (const declarator of declaration.declarations) {
              if (isFunctionValue(declarator.init))
                check(declarator, declarator.id.name);
            }
            return;
          }
          for (const specifier of node.specifiers) {
            if (specifier.exportKind === 'type') continue;
            const name = specifier.local.name ?? specifier.local.value;
            if (node.source || isFunctionBinding(context, specifier, name))
              check(specifier, name);
          }
        },
      };
    },
  };
}

const CONFIG_FACTORY_NAME = /^load[A-Z][A-Za-z0-9]*Config$/;

export const configExports = exportedFunctionRule(
  '.config.ts는 상수, 타입, 설정 클래스와 load*Config 팩토리만 export한다. 도메인 함수는 서비스로 옮긴다.',
  (name) => CONFIG_FACTORY_NAME.test(name),
);

function isInjectableDecorator(decorator) {
  const { expression } = decorator;
  return (
    expression.type === 'CallExpression' &&
    expression.callee.type === 'Identifier' &&
    expression.callee.name === 'Injectable'
  );
}

export const injectableRoleClass = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      notInjectable:
        '{{name}}는 @Injectable()로 등록하고 생성자 주입으로 받는다.',
      staticMember:
        '{{name}}의 static 멤버는 인스턴스 메서드로 바꿔 생성자 주입으로 쓴다.',
    },
  },
  create(context) {
    return {
      ClassDeclaration(node) {
        const name = node.id?.name ?? 'default';
        if (!(node.decorators ?? []).some(isInjectableDecorator))
          context.report({
            node: node.id,
            messageId: 'notInjectable',
            data: { name },
          });
        for (const member of node.body.body)
          if (member.static)
            context.report({
              node: member,
              messageId: 'staticMember',
              data: { name },
            });
      },
    };
  },
};

export const serviceExports = exportedFunctionRule(
  '역할 클래스 파일은 클래스와 타입만 export한다. 함수는 메서드로 옮겨 생성자 주입으로 쓴다.',
  () => false,
);
