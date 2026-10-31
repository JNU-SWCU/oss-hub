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

function isFunctionBinding(context, node, name) {
  let scope = context.sourceCode.getScope(node);
  while (scope && !scope.set.has(name)) scope = scope.upper;
  const definition = scope?.set.get(name)?.defs[0];
  if (!definition) return false;
  if (definition.type === 'FunctionName') return true;
  return (
    definition.type === 'Variable' && isFunctionValue(definition.node.init)
  );
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
          const { declaration } = node;
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

export const serviceExports = exportedFunctionRule(
  '서비스 파일은 클래스와 타입만 export한다. 함수는 메서드로 옮겨 생성자 주입으로 쓴다.',
  () => false,
);
