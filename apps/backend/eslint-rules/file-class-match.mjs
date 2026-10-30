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

function exportedClasses(program) {
  const classes = new Set(
    program.body
      .filter((node) => node.type === 'ClassDeclaration')
      .map((node) => node.id.name),
  );
  return program.body.flatMap((node) => {
    if (
      node.type === 'ExportNamedDeclaration' ||
      node.type === 'ExportDefaultDeclaration'
    ) {
      if (node.declaration?.type === 'ClassDeclaration') {
        return node.declaration.id ? [node.declaration.id] : [];
      }
      return (node.specifiers ?? [])
        .filter((specifier) => classes.has(specifier.local.name))
        .map((specifier) => specifier.local);
    }
    return [];
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
