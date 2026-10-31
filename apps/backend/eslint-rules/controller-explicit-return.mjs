import ts from 'typescript';

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

function decoratorCall(decorator) {
  const { expression } = decorator;
  return expression.type === 'CallExpression' &&
    expression.callee.type === 'Identifier'
    ? expression
    : undefined;
}

const forbiddenFlags = [
  [ts.TypeFlags.Null, 'null'],
  [ts.TypeFlags.Undefined, 'undefined'],
  [ts.TypeFlags.Any, 'any'],
  [ts.TypeFlags.Unknown, 'unknown'],
];

const isErrorType = (type) => type.intrinsicName === 'error';

const isReference = (type) =>
  Boolean(
    type.flags & ts.TypeFlags.Object &&
    type.objectFlags & ts.ObjectFlags.Reference,
  );

function typeArguments(checker, type) {
  const args = isReference(type) ? checker.getTypeArguments(type) : [];
  return [...args, ...(type.aliasTypeArguments ?? [])];
}

function findForbiddenType(checker, type, seen = new Set()) {
  if (seen.has(type) || isErrorType(type)) return undefined;
  seen.add(type);
  const hit = forbiddenFlags.find(([flag]) => type.flags & flag);
  if (hit) return hit[1];
  const children = type.isUnionOrIntersection() ? type.types : [];
  for (const child of [...children, ...typeArguments(checker, type)]) {
    const found = findForbiddenType(checker, child, seen);
    if (found) return found;
  }
  return undefined;
}

function classSymbol(type) {
  const symbol = type.getSymbol();
  return symbol && symbol.flags & ts.SymbolFlags.Class ? symbol : undefined;
}

function isResponseDtoClass(type) {
  return classSymbol(type)?.getName().endsWith('ResponseDto') === true;
}

function isAllowedType(checker, type) {
  if (isErrorType(type)) return false;
  if (type.flags & ts.TypeFlags.Void) return true;
  if (classSymbol(type)?.getName() === 'StreamableFile') return true;
  if (isResponseDtoClass(type)) return true;
  if (!checker.isArrayType(type)) return false;
  const [element] = checker.getTypeArguments(type);
  return element !== undefined && isResponseDtoClass(element);
}

function unwrapPromise(checker, type) {
  return type.getSymbol()?.getName() === 'Promise' && isReference(type)
    ? checker.getTypeArguments(type)[0]
    : type;
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
    const { visitorKeys, parserServices } = context.sourceCode;
    if (!parserServices?.program) {
      throw new Error(
        'controller-explicit-return는 타입 정보(parserOptions.projectService)가 필요하다.',
      );
    }
    const checker = parserServices.program.getTypeChecker();
    return {
      MethodDefinition(node) {
        const verb = node.decorators
          ?.map(decoratorCall)
          .find((call) => call && httpDecorators.has(call.callee.name));
        if (!verb) return;
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
        const declared = checker.getTypeFromTypeNode(
          parserServices.esTreeNodeToTSNodeMap.get(annotation),
        );
        const forbidden = findForbiddenType(checker, declared);
        if (forbidden) {
          context.report({
            node: annotation,
            messageId: 'forbidden',
            data: { type: forbidden },
          });
          return;
        }
        const body = unwrapPromise(checker, declared);
        const members = body?.isUnion() ? body.types : [body];
        if (!members.every((type) => type && isAllowedType(checker, type))) {
          context.report({ node: annotation, messageId: 'invalid' });
        }
      },
    };
  },
};
