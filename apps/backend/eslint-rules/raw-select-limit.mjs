const RAW_METHODS = new Set([
  '$queryRaw',
  '$queryRawUnsafe',
  '$executeRaw',
  '$executeRawUnsafe',
]);
const WRITE_KEYWORDS = new Set(['INSERT', 'UPDATE', 'DELETE', 'MERGE']);

const propertyName = (node) =>
  node?.type === 'MemberExpression' && !node.computed
    ? node.property.name
    : undefined;

const isSqlTag = (tag) =>
  (tag?.type === 'Identifier' && tag.name === 'sql') ||
  propertyName(tag) === 'sql';

const templateText = (template) =>
  template.quasis.map((quasi) => quasi.value.cooked ?? '').join(' ? ');

const topLevelWords = (sql) => {
  const text = sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^']|'')*'/g, ' ? ')
    .replace(/"(?:[^"]|"")*"/g, ' ? ');
  const words = [];
  let depth = 0;
  for (const token of text.match(/[()]|[A-Za-z_]+/g) ?? []) {
    if (token === '(') depth += 1;
    else if (token === ')') depth -= 1;
    else if (depth === 0) words.push(token.toUpperCase());
  }
  return words;
};

const missingTopLevelLimit = (sql) => {
  const words = topLevelWords(sql);
  const writes = words.some(
    (word, index) =>
      WRITE_KEYWORDS.has(word) &&
      !(word === 'UPDATE' && ['FOR', 'KEY'].includes(words[index - 1])),
  );
  if (writes) return false;
  return words.includes('SELECT') && !words.includes('LIMIT');
};

export const rawSelectLimit = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      missingLimit:
        'raw SELECT에 최상위 LIMIT가 없다. 상한(CAP + 1)이나 페이지 크기로 LIMIT를 두고, 한 행만 돌려주는 집계는 LIMIT 1을 둔다.',
      unresolved:
        'raw 쿼리의 SQL을 이 파일에서 확인할 수 없다. SQL 템플릿을 호출 위치에 직접 쓴다.',
    },
  },
  create(context) {
    const definitionOf = (identifier) => {
      let scope = context.sourceCode.getScope(identifier);
      while (scope) {
        const variable = scope.set.get(identifier.name);
        if (variable) return variable.defs[0]?.node;
        scope = scope.upper;
      }
      return undefined;
    };

    const returnedValues = (fn) => {
      if (fn.body.type !== 'BlockStatement') return [fn.body];
      const values = [];
      const visit = (node) => {
        if (!node || typeof node.type !== 'string') return;
        if (
          node !== fn &&
          (node.type === 'FunctionDeclaration' ||
            node.type === 'FunctionExpression' ||
            node.type === 'ArrowFunctionExpression')
        )
          return;
        if (node.type === 'ReturnStatement') values.push(node.argument);
        for (const [key, child] of Object.entries(node)) {
          if (key === 'parent') continue;
          if (Array.isArray(child)) child.forEach(visit);
          else if (child && typeof child.type === 'string') visit(child);
        }
      };
      visit(fn.body);
      return values;
    };

    const resolveSql = (node, seen = new Set()) => {
      if (!node || seen.has(node)) return undefined;
      seen.add(node);
      if (node.type === 'TemplateLiteral') return [templateText(node)];
      if (node.type === 'Literal' && typeof node.value === 'string')
        return [node.value];
      if (node.type === 'TaggedTemplateExpression' && isSqlTag(node.tag))
        return [templateText(node.quasi)];
      if (
        node.type === 'TSAsExpression' ||
        node.type === 'TSSatisfiesExpression'
      )
        return resolveSql(node.expression, seen);
      if (node.type === 'CallExpression' && node.callee.type === 'Identifier') {
        const definition = definitionOf(node.callee);
        const fn =
          definition?.type === 'FunctionDeclaration'
            ? definition
            : definition?.type === 'VariableDeclarator' &&
                (definition.init?.type === 'ArrowFunctionExpression' ||
                  definition.init?.type === 'FunctionExpression')
              ? definition.init
              : undefined;
        if (!fn) return undefined;
        const resolved = returnedValues(fn).map((value) =>
          resolveSql(value, seen),
        );
        return resolved.length > 0 && resolved.every(Boolean)
          ? resolved.flat()
          : undefined;
      }
      if (node.type !== 'Identifier') return undefined;
      const definition = definitionOf(node);
      return definition?.type === 'VariableDeclarator' &&
        definition.parent.kind === 'const'
        ? resolveSql(definition.init, seen)
        : undefined;
    };

    const check = (node, sqls) => {
      if (sqls === undefined) context.report({ node, messageId: 'unresolved' });
      else if (sqls.some(missingTopLevelLimit))
        context.report({ node, messageId: 'missingLimit' });
    };

    return {
      TaggedTemplateExpression(node) {
        if (RAW_METHODS.has(propertyName(node.tag)))
          check(node, [templateText(node.quasi)]);
      },
      CallExpression(node) {
        if (RAW_METHODS.has(propertyName(node.callee)))
          check(node, resolveSql(node.arguments[0]));
      },
    };
  },
};
