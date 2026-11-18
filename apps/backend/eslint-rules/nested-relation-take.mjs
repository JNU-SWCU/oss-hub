import { readFileSync } from 'node:fs';

const schema = readFileSync(
  new URL('../prisma/schema.prisma', import.meta.url),
  'utf8',
);
const models = new Set(
  [...schema.matchAll(/^model (\w+) \{/gm)].map((match) => match[1]),
);
const listRelations = new Set(
  [...schema.matchAll(/^model \w+ \{([\s\S]*?)^\}/gm)].flatMap(([, body]) =>
    [...body.matchAll(/^\s+(\w+)\s+(\w+)\[\]/gm)]
      .filter(([, , type]) => models.has(type))
      .map(([, field]) => field),
  ),
);

const keyName = (property) =>
  property.type === 'Property' && !property.computed
    ? (property.key.name ?? property.key.value)
    : undefined;

const unwrap = (node) => {
  let current = node;
  while (
    current &&
    (current.type === 'TSAsExpression' ||
      current.type === 'TSSatisfiesExpression' ||
      current.type === 'TSNonNullExpression')
  )
    current = current.expression;
  return current;
};

const isSelectionTyped = (node) => {
  for (
    let parent = node.parent;
    parent?.type === 'TSAsExpression' ||
    parent?.type === 'TSSatisfiesExpression';
    parent = parent.parent
  ) {
    const annotation = parent.typeAnnotation;
    if (annotation?.type !== 'TSTypeReference') continue;
    const name = annotation.typeName;
    const typeName =
      name.type === 'TSQualifiedName' ? name.right.name : name.name;
    if (/(Select|Include)$/.test(typeName)) return true;
  }
  return false;
};

export const nestedRelationTake = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      missingTake:
        '{{relation}} 관계 읽기에 take가 없다. 상한(CAP + 1)으로 take를 지정하고 넘치면 실패시킨다.',
    },
  },
  create(context) {
    const resolve = (node) => {
      const value = unwrap(node);
      if (value?.type !== 'Identifier') return value;
      let scope = context.sourceCode.getScope(value);
      while (scope) {
        const variable = scope.set.get(value.name);
        if (variable) {
          const definition = variable.defs[0]?.node;
          return definition?.type === 'VariableDeclarator' &&
            definition.parent.kind === 'const'
            ? unwrap(definition.init)
            : undefined;
        }
        scope = scope.upper;
      }
      return undefined;
    };

    const hasTake = (node, seen = new Set()) => {
      const value = resolve(node);
      if (value?.type !== 'ObjectExpression' || seen.has(value)) return false;
      seen.add(value);
      return value.properties.some((property) =>
        property.type === 'SpreadElement'
          ? hasTake(property.argument, seen)
          : keyName(property) === 'take',
      );
    };

    const checkSelection = (selection) => {
      for (const property of selection.properties) {
        const relation = keyName(property);
        if (!listRelations.has(relation) || hasTake(property.value)) continue;
        context.report({
          node: property,
          messageId: 'missingTake',
          data: { relation },
        });
      }
    };

    return {
      Property(node) {
        const key = keyName(node);
        if (key !== 'select' && key !== 'include') return;
        if (unwrap(node.value)?.type !== 'Identifier') return;
        const selection = resolve(node.value);
        if (selection?.type === 'ObjectExpression') checkSelection(selection);
      },
      ObjectExpression(node) {
        if (isSelectionTyped(node)) {
          checkSelection(node);
          return;
        }
        const property = node.parent;
        const key = property?.type === 'Property' ? keyName(property) : null;
        if (key !== 'select' && key !== 'include') return;
        const owner = property.parent?.parent;
        if (owner?.type === 'Property' && keyName(owner) === '_count') return;
        checkSelection(node);
      },
    };
  },
};
