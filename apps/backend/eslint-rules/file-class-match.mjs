import path from 'node:path';

const roleSuffixes = {
  module: 'Module',
  controller: 'Controller',
  service: 'Service',
  repository: 'Repository',
  guard: 'Guard',
  interceptor: 'Interceptor',
  filter: 'Filter',
  client: 'Client',
  job: 'Job',
  scheduler: 'Scheduler',
};

const pascalCase = (stem) =>
  stem
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');

function expectation(filename) {
  const base = path.basename(filename);
  const dto = /^(.+-(request|response))\.dto\.ts$/.exec(base);
  if (dto) {
    return {
      expected: `${pascalCase(dto[1])}Dto`,
      suffix: `${pascalCase(dto[2])}Dto`,
    };
  }
  const role = /^(.+)\.([a-z]+)\.ts$/.exec(base);
  const suffix = role && roleSuffixes[role[2]];
  return suffix
    ? { expected: `${pascalCase(role[1])}${suffix}`, suffix }
    : undefined;
}

const isClass = (node) =>
  node?.type === 'ClassDeclaration' || node?.type === 'ClassExpression';

const classBindings = (declaration) =>
  declaration?.type === 'VariableDeclaration'
    ? declaration.declarations.filter(
        (declarator) =>
          declarator.id.type === 'Identifier' && isClass(declarator.init),
      )
    : [];

const unwrap = (node) =>
  node?.type === 'ExportNamedDeclaration' ? node.declaration : node;

function exportedClasses(program) {
  const classes = new Set(
    program.body.flatMap((node) => {
      const declaration = unwrap(node);
      if (declaration?.type === 'ClassDeclaration' && declaration.id) {
        return [declaration.id.name];
      }
      return classBindings(declaration).map((item) => item.id.name);
    }),
  );
  return program.body.flatMap((node) => {
    if (node.type === 'ExportDefaultDeclaration') {
      const { declaration } = node;
      if (isClass(declaration)) {
        return [declaration.id ?? { ...declaration, name: 'default' }];
      }
      return declaration.type === 'Identifier' && classes.has(declaration.name)
        ? [declaration]
        : [];
    }
    if (node.type !== 'ExportNamedDeclaration') return [];
    if (node.declaration?.type === 'ClassDeclaration') {
      return [node.declaration.id];
    }
    if (node.declaration) {
      return classBindings(node.declaration).map((item) => item.id);
    }
    if (node.source) return [];
    return node.specifiers
      .filter((specifier) => classes.has(specifier.local.name))
      .map((specifier) =>
        specifier.exported.type === 'Identifier'
          ? specifier.exported
          : { ...specifier.exported, name: specifier.exported.value },
      );
  });
}

export const fileClassMatch = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      missing: '이 파일은 {{expected}} 클래스를 export한다.',
      extra: '추가로 export하는 클래스 {{name}}도 {{suffix}}로 끝난다.',
    },
  },
  create(context) {
    const target = expectation(context.filename);
    if (!target) return {};
    return {
      Program(node) {
        const classes = exportedClasses(node);
        if (!classes.some((id) => id.name === target.expected)) {
          context.report({
            node,
            messageId: 'missing',
            data: { expected: target.expected },
          });
        }
        for (const id of classes) {
          if (!id.name.endsWith(target.suffix)) {
            context.report({
              node: id,
              messageId: 'extra',
              data: { name: id.name, suffix: target.suffix },
            });
          }
        }
      },
    };
  },
};
