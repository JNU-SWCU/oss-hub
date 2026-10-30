function decoratorTarget(decorator) {
  const { expression } = decorator;
  return expression.type === 'CallExpression' ? expression.callee : expression;
}

export const requestDtoDecorated = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      undecorated:
        'Request DTO 필드에는 class-validator 데코레이터를 하나 이상 둔다. @IsOptional만으로는 부족하다.',
    },
  },
  create(context) {
    const validators = new Map();
    const namespaces = new Set();
    const importedName = (target) => {
      if (target.type === 'Identifier') return validators.get(target.name);
      if (
        target.type === 'MemberExpression' &&
        !target.computed &&
        target.object.type === 'Identifier' &&
        namespaces.has(target.object.name) &&
        target.property.type === 'Identifier'
      ) {
        return target.property.name;
      }
      return undefined;
    };
    return {
      ImportDeclaration(node) {
        if (node.source.value !== 'class-validator') return;
        for (const specifier of node.specifiers) {
          if (specifier.type === 'ImportSpecifier') {
            const { imported } = specifier;
            validators.set(
              specifier.local.name,
              imported.type === 'Identifier' ? imported.name : imported.value,
            );
          } else if (specifier.type === 'ImportNamespaceSpecifier') {
            namespaces.add(specifier.local.name);
          }
        }
      },
      PropertyDefinition(node) {
        if (node.static) return;
        const validated = node.decorators?.some((decorator) => {
          const name = importedName(decoratorTarget(decorator));
          return name !== undefined && name !== 'IsOptional';
        });
        if (!validated) {
          context.report({ node: node.key, messageId: 'undecorated' });
        }
      },
    };
  },
};
