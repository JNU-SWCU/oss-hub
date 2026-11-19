const FUNCTION_TYPES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
]);
const PROMISE_CALLBACKS = new Set(['then', 'catch', 'finally']);

const selfName = (fn) => {
  if (fn.type === 'FunctionDeclaration')
    return { kind: 'name', name: fn.id?.name };
  const parent = fn.parent;
  if (parent?.type === 'VariableDeclarator' && parent.id.type === 'Identifier')
    return { kind: 'name', name: parent.id.name };
  if (parent?.type === 'MethodDefinition' && !parent.computed)
    return { kind: 'member', name: parent.key.name };
  if (
    parent?.type === 'PropertyDefinition' &&
    !parent.computed &&
    parent.key.type === 'Identifier'
  )
    return { kind: 'member', name: parent.key.name };
  return undefined;
};

const isSelfCall = (node, self) => {
  if (node.type !== 'CallExpression' || self?.name === undefined) return false;
  const callee = node.callee;
  if (self.kind === 'name')
    return callee.type === 'Identifier' && callee.name === self.name;
  return (
    callee.type === 'MemberExpression' &&
    callee.object.type === 'ThisExpression' &&
    !callee.computed &&
    callee.property.name === self.name
  );
};

const isPromiseCallback = (fn) => {
  const call = fn.parent;
  return (
    call?.type === 'CallExpression' &&
    call.arguments.includes(fn) &&
    call.callee.type === 'MemberExpression' &&
    !call.callee.computed &&
    PROMISE_CALLBACKS.has(call.callee.property.name)
  );
};

const bindingNames = (pattern, out) => {
  if (!pattern) return out;
  switch (pattern.type) {
    case 'Identifier':
      out.push(pattern.name);
      break;
    case 'ObjectPattern':
      for (const property of pattern.properties)
        bindingNames(
          property.type === 'RestElement' ? property.argument : property.value,
          out,
        );
      break;
    case 'ArrayPattern':
      for (const element of pattern.elements) bindingNames(element, out);
      break;
    case 'AssignmentPattern':
      bindingNames(pattern.left, out);
      break;
    case 'RestElement':
      bindingNames(pattern.argument, out);
      break;
    default:
      break;
  }
  return out;
};

export const noCounterRecursion = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      counterRecursion:
        '자기 자신을 이어 부르는 재귀 루프다. 인자가 이번 호출에서 받은 값(이전 페이지의 커서)에서 오지 않으면 await-in-loop를 감출 뿐이다. 독립 작업은 Promise.all이나 배치 쿼리로, 순서가 필요한 작업은 SequentialRepository.forEach나 repeat로 쓴다.',
    },
  },
  create(context) {
    const keys = context.sourceCode.visitorKeys;
    const walk = (node, visit, enterFunction) => {
      if (!node || typeof node.type !== 'string') return;
      if (visit(node) === false) return;
      for (const key of keys[node.type] ?? []) {
        const child = node[key];
        if (Array.isArray(child))
          for (const item of child) {
            if (item && FUNCTION_TYPES.has(item.type) && !enterFunction(item))
              continue;
            walk(item, visit, enterFunction);
          }
        else if (child && typeof child.type === 'string') {
          if (FUNCTION_TYPES.has(child.type) && !enterFunction(child)) continue;
          walk(child, visit, enterFunction);
        }
      }
    };
    const mentions = (node, names) => {
      let found = false;
      walk(
        node,
        (current) => {
          if (current.type === 'AwaitExpression') found = true;
          if (current.type === 'Identifier' && names.has(current.name))
            found = true;
          return !found;
        },
        () => false,
      );
      return found;
    };

    const check = (fn) => {
      const self = selfName(fn);
      if (self?.name === undefined) return;
      const enterCallbacks = (inner) => isPromiseCallback(inner);
      const resolved = new Set();
      const declarators = [];
      walk(
        fn.body,
        (node) => {
          if (node.type === 'VariableDeclarator') declarators.push(node);
          if (FUNCTION_TYPES.has(node.type) && isPromiseCallback(node))
            for (const param of node.params)
              bindingNames(param, []).forEach((name) => resolved.add(name));
          return true;
        },
        enterCallbacks,
      );
      for (let changed = true; changed;) {
        changed = false;
        for (const declarator of declarators) {
          if (declarator.init && mentions(declarator.init, resolved))
            for (const name of bindingNames(declarator.id, []))
              if (!resolved.has(name)) {
                resolved.add(name);
                changed = true;
              }
        }
      }
      const loopForming = (call) => {
        const parent = call.parent;
        if (parent?.type === 'AwaitExpression') return true;
        let owner = parent;
        while (owner && !FUNCTION_TYPES.has(owner.type)) owner = owner.parent;
        if (owner !== fn) return isPromiseCallback(owner);
        if (!fn.async) return false;
        return (
          parent?.type === 'ReturnStatement' ||
          (fn.type === 'ArrowFunctionExpression' && fn.body === call)
        );
      };
      walk(
        fn.body,
        (node) => {
          if (
            isSelfCall(node, self) &&
            loopForming(node) &&
            !node.arguments.some((argument) => mentions(argument, resolved))
          )
            context.report({ node, messageId: 'counterRecursion' });
          return true;
        },
        enterCallbacks,
      );
    };

    return {
      FunctionDeclaration: check,
      FunctionExpression: check,
      ArrowFunctionExpression: check,
    };
  },
};
