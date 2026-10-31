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
        walk(member.value.body ?? member.value, (node) => {
          if (BRANCHES.has(node.type))
            context.report({ node, messageId: 'branching' });
          if (node.type === 'CallExpression' && isServiceCall(node)) {
            serviceCalls += 1;
            if (serviceCalls === 2)
              context.report({ node, messageId: 'serviceCalls' });
          }
        });
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
