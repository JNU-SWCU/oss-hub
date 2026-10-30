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
    const validators = new Set();
    return {
      ImportDeclaration(node) {
        if (node.source.value !== 'class-validator') return;
        for (const specifier of node.specifiers) {
          if (specifier.type === 'ImportSpecifier') {
            validators.add(specifier.local.name);
          }
        }
      },
      PropertyDefinition(node) {
        if (node.static) return;
        const validated = node.decorators?.some((decorator) => {
          const { expression } = decorator;
          const name =
            expression.type === 'CallExpression'
              ? expression.callee.name
              : expression.name;
          return validators.has(name) && name !== 'IsOptional';
        });
        if (!validated) {
          context.report({ node: node.key, messageId: 'undecorated' });
        }
      },
    };
  },
};
