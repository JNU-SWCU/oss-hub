const httpDecorators = new Set([
  'Get',
  'Post',
  'Put',
  'Patch',
  'Delete',
  'Head',
  'Options',
  'All',
]);
const forbiddenTypes = {
  TSNullKeyword: 'null',
  TSUndefinedKeyword: 'undefined',
  TSAnyKeyword: 'any',
  TSUnknownKeyword: 'unknown',
};

export const returnTypeAllowlist = new Set([
  'GET programs/:programId/applications/me',
  'GET application-preparations/programs/:programId/me',
]);

function decoratorCall(decorator) {
  const { expression } = decorator;
  return expression.type === 'CallExpression' &&
    expression.callee.type === 'Identifier'
    ? expression
    : undefined;
}

function firstStringArgument(call) {
  const [first] = call.arguments;
  return first?.type === 'Literal' && typeof first.value === 'string'
    ? first.value
    : '';
}

function routeName(method, verb) {
  const controller = method.parent.parent.decorators
    ?.map(decoratorCall)
    .find((call) => call?.callee.name === 'Controller');
  const parts = [
    controller ? firstStringArgument(controller) : '',
    firstStringArgument(verb),
  ].filter(Boolean);
  return `${verb.callee.name.toUpperCase()} ${parts.join('/')}`;
}

function typeName(node) {
  return node.type === 'TSTypeReference' && node.typeName.type === 'Identifier'
    ? node.typeName.name
    : undefined;
}

function isResponseDto(node) {
  return typeName(node)?.endsWith('ResponseDto') === true;
}

function isAllowedMember(node) {
  if (node.type === 'TSVoidKeyword') return true;
  if (typeName(node) === 'StreamableFile' || isResponseDto(node)) return true;
  const array =
    node.type === 'TSTypeOperator' && node.operator === 'readonly'
      ? node.typeAnnotation
      : node;
  return array.type === 'TSArrayType' && isResponseDto(array.elementType);
}

function findForbidden(node, visitorKeys) {
  if (forbiddenTypes[node.type]) return forbiddenTypes[node.type];
  for (const key of visitorKeys[node.type] ?? []) {
    const children = [node[key]].flat();
    for (const child of children) {
      if (!child) continue;
      const found = findForbidden(child, visitorKeys);
      if (found) return found;
    }
  }
  return undefined;
}

export const controllerExplicitReturn = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      missing: '컨트롤러 핸들러는 반환 타입을 명시한다.',
      forbidden:
        '핸들러 반환 타입에 {{type}}을 쓰지 않는다. 값이 없으면 상태 필드를 가진 응답 DTO로 표현한다.',
      invalid:
        '핸들러 반환 타입은 Promise로 한 번 감쌀 수 있는 *ResponseDto, *ResponseDto 배열, void, StreamableFile만 쓴다.',
    },
  },
  create(context) {
    const { visitorKeys } = context.sourceCode;
    return {
      MethodDefinition(node) {
        const verb = node.decorators
          ?.map(decoratorCall)
          .find((call) => call && httpDecorators.has(call.callee.name));
        if (!verb || returnTypeAllowlist.has(routeName(node, verb))) return;
        const annotation = node.value.returnType?.typeAnnotation;
        if (!annotation) {
          context.report({ node: node.key, messageId: 'missing' });
          return;
        }
        const type = findForbidden(annotation, visitorKeys);
        if (type) {
          context.report({
            node: annotation,
            messageId: 'forbidden',
            data: { type },
          });
          return;
        }
        const body =
          typeName(annotation) === 'Promise'
            ? (annotation.typeArguments?.params[0] ?? annotation)
            : annotation;
        const members = body.type === 'TSUnionType' ? body.types : [body];
        if (!members.every(isAllowedMember)) {
          context.report({ node: annotation, messageId: 'invalid' });
        }
      },
    };
  },
};
