const BRANCHES = new Set([
  'IfStatement',
  'SwitchStatement',
  'ForStatement',
  'ForInStatement',
  'ForOfStatement',
  'WhileStatement',
  'DoWhileStatement',
  'TryStatement',
]);

const isHidden = (member) =>
  member.accessibility === 'private' ||
  member.accessibility === 'protected' ||
  member.key?.type === 'PrivateIdentifier';

const isServiceCall = (node) =>
  node.callee.type === 'MemberExpression' &&
  node.callee.object.type === 'MemberExpression' &&
  node.callee.object.object.type === 'ThisExpression';

const RESPONSE_DTO = /ResponseDto$/;

const isResponseMapping = (node) =>
  node.type === 'CallExpression' &&
  node.callee.type === 'MemberExpression' &&
  !node.callee.computed &&
  node.callee.object.type === 'Identifier' &&
  RESPONSE_DTO.test(node.callee.object.name) &&
  node.callee.property.name === 'from';

const isResultRead = (node, name) =>
  (node.type === 'Identifier' && node.name === name) ||
  (node.type === 'MemberExpression' &&
    !node.computed &&
    node.property.type === 'Identifier' &&
    isResultRead(node.object, name));

function isPurePredicate(node, name) {
  switch (node.type) {
    case 'Literal':
      return true;
    case 'Identifier':
    case 'MemberExpression':
      return isResultRead(node, name);
    case 'UnaryExpression':
      return node.operator === '!' && isPurePredicate(node.argument, name);
    case 'BinaryExpression':
      return (
        (node.operator === '===' || node.operator === '!==') &&
        isPurePredicate(node.left, name) &&
        isPurePredicate(node.right, name)
      );
    case 'LogicalExpression':
      return (
        (node.operator === '&&' || node.operator === '||') &&
        isPurePredicate(node.left, name) &&
        isPurePredicate(node.right, name)
      );
    default:
      return false;
  }
}

const readsResult = (node, name) => {
  let reads = false;
  walk(node, (child) => {
    if (isResultRead(child, name)) reads = true;
  });
  return reads;
};

function serviceResultNames(body) {
  const names = new Set();
  for (const statement of body.body ?? [])
    if (statement.type === 'VariableDeclaration')
      for (const declarator of statement.declarations) {
        const init =
          declarator.init?.type === 'AwaitExpression'
            ? declarator.init.argument
            : declarator.init;
        if (
          declarator.id.type === 'Identifier' &&
          init?.type === 'CallExpression' &&
          isServiceCall(init)
        )
          names.add(declarator.id.name);
      }
  return names;
}

function isResponseChoice(node, resultNames) {
  if (!isResponseMapping(node.consequent) || !isResponseMapping(node.alternate))
    return false;
  return [...resultNames].some(
    (name) =>
      readsResult(node.test, name) &&
      isPurePredicate(node.test, name) &&
      [node.consequent, node.alternate].every(
        (call) =>
          call.arguments.length === 1 && isResultRead(call.arguments[0], name),
      ),
  );
}

const OPERATORS = new Set([
  'BinaryExpression',
  'LogicalExpression',
  'UnaryExpression',
  'UpdateExpression',
  'AssignmentExpression',
  'SequenceExpression',
  'TemplateLiteral',
]);

const isHandlerStatement = (statement, resultNames) =>
  statement.type === 'ReturnStatement' ||
  statement.type === 'ExpressionStatement' ||
  (statement.type === 'VariableDeclaration' &&
    statement.declarations.every(
      (declarator) =>
        declarator.id.type === 'Identifier' &&
        resultNames.has(declarator.id.name),
    ));

const handlerParams = (member) =>
  new Set(
    member.value.params
      .map((param) =>
        param.type === 'TSParameterProperty' ? param.parameter : param,
      )
      .map((param) => (param.type === 'AssignmentPattern' ? param.left : param))
      .filter((param) => param.type === 'Identifier')
      .map((param) => param.name),
  );

const CONSTANT = /^[A-Z][A-Z0-9_]*$/;

function isStaticValue(node, params) {
  switch (node.type) {
    case 'Literal':
      return true;
    case 'Identifier':
      return params.has(node.name) || CONSTANT.test(node.name);
    case 'MemberExpression':
      return (
        !node.computed &&
        node.property.type === 'Identifier' &&
        isStaticValue(node.object, params) &&
        node.object.type !== 'Literal'
      );
    default:
      return false;
  }
}

function isStaticResponse(body, params) {
  const statements = body.body ?? [];
  if (statements.length === 0) return true;
  if (statements.length !== 1 || statements[0].type !== 'ReturnStatement')
    return false;
  const value = statements[0].argument;
  if (value === null) return true;
  if (isResponseMapping(value))
    return value.arguments.every((argument) => isStaticValue(argument, params));
  return isStaticValue(value, params);
}

const isResponseListMapping = (node) =>
  node.callee.type === 'MemberExpression' &&
  !node.callee.computed &&
  node.callee.property.name === 'map' &&
  node.arguments.length === 1 &&
  node.arguments[0].type === 'ArrowFunctionExpression' &&
  isResponseMapping(node.arguments[0].body);

function isAllowedCall(node) {
  if (
    isServiceCall(node) ||
    isResponseMapping(node) ||
    isResponseListMapping(node)
  )
    return true;
  return false;
}

function walk(node, visit) {
  visit(node);
  for (const key of Object.keys(node)) {
    if (key === 'parent') continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value)
        if (child && typeof child.type === 'string') walk(child, visit);
    } else if (value && typeof value.type === 'string') walk(value, visit);
  }
}

export const thinController = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      hiddenMethod:
        'controller에는 private 메서드를 두지 않는다. 로직은 담당 서비스로 옮긴다.',
      clock: 'controller는 시각을 만들지 않는다. 서비스가 시각을 정한다.',
      branching:
        'controller 메서드는 분기하지 않는다. HTTP 입력을 서비스 호출 하나로 넘기고 결과를 돌려준다.',
      serviceCalls: 'controller 메서드는 서비스를 한 번만 호출한다.',
      expression:
        'controller 메서드는 서비스 호출 하나와 그 결과의 응답 매핑만 쓴다. 연산·문자열 조합·다른 지역 변수는 담당 서비스로 옮긴다.',
      noService:
        '서비스를 부르지 않는 controller 메서드는 리터럴·상수나 파라미터로 만든 응답 DTO의 from()만 돌려준다. 계산은 담당 서비스로 옮긴다.',
      conditional:
        'controller의 조건식은 서비스 결과 하나를 읽어 응답 DTO 둘 중 하나의 from()을 고를 때만 쓴다. 나머지 판단은 서비스로 옮긴다.',
      domainCall:
        'controller는 서비스 호출과 응답 DTO의 from() 매핑만 호출한다. 파싱·포맷·계산은 담당 서비스로 옮긴다.',
    },
  },
  create(context) {
    return {
      'ClassDeclaration > ClassBody > MethodDefinition'(member) {
        if (member.kind === 'constructor') return;
        if (isHidden(member)) {
          context.report({ node: member.key, messageId: 'hiddenMethod' });
          return;
        }
        let serviceCalls = 0;
        const body = member.value.body ?? member.value;
        const resultNames = serviceResultNames(body);
        const checkedNodes = new Set();
        const expressions = (body.body ?? []).filter(
          (statement) =>
            !BRANCHES.has(statement.type) &&
            !isHandlerStatement(statement, resultNames),
        );
        walk(body, (node) => {
          if (BRANCHES.has(node.type))
            context.report({ node, messageId: 'branching' });
          if (node.type === 'ConditionalExpression') {
            const allowed = isResponseChoice(node, resultNames);
            walk(allowed ? node.test : node, (child) =>
              checkedNodes.add(child),
            );
            if (!allowed) context.report({ node, messageId: 'conditional' });
          }
          if (OPERATORS.has(node.type) && !checkedNodes.has(node))
            expressions.push(node);
          if (
            (node.type === 'CallExpression' && !isAllowedCall(node)) ||
            (node.type === 'NewExpression' && node.callee.name !== 'Date')
          )
            context.report({ node, messageId: 'domainCall' });
          if (node.type === 'CallExpression' && isServiceCall(node)) {
            serviceCalls += 1;
            if (serviceCalls === 2)
              context.report({ node, messageId: 'serviceCalls' });
          }
        });
        if (serviceCalls === 0) {
          if (!isStaticResponse(body, handlerParams(member)))
            context.report({ node: member.key, messageId: 'noService' });
          return;
        }
        for (const node of expressions)
          context.report({ node, messageId: 'expression' });
      },
      'NewExpression[callee.name="Date"]'(node) {
        context.report({ node, messageId: 'clock' });
      },
      'CallExpression[callee.object.name="Date"][callee.property.name="now"]'(
        node,
      ) {
        context.report({ node, messageId: 'clock' });
      },
    };
  },
};
