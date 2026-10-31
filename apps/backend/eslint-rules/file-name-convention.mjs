import path from 'node:path';

const rootSuffixes = [
  '.module',
  '.controller',
  '.service',
  '.repository',
  '.guard',
  '.interceptor',
  '.filter',
  '.client',
  '.error',
  '.types',
  '.config',
];
const dtoSuffixes = ['-request.dto.ts', '-response.dto.ts'];

const kebab = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function isValid(filename) {
  const base = path.basename(filename);
  if (path.basename(path.dirname(filename)) === 'dto') {
    const suffix = dtoSuffixes.find((candidate) => base.endsWith(candidate));
    return suffix !== undefined && kebab.test(base.slice(0, -suffix.length));
  }
  const suffix = rootSuffixes.find((candidate) =>
    base.endsWith(`${candidate}.ts`),
  );
  return (
    suffix !== undefined && kebab.test(base.slice(0, -`${suffix}.ts`.length))
  );
}

export const fileNameConvention = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      invalid:
        '파일 이름은 kebab-case stem에 ADR-003 닫힌 접미사를 붙인다: {{file}}',
    },
  },
  create(context) {
    return {
      Program(node) {
        if (isValid(context.filename)) return;
        context.report({
          node,
          messageId: 'invalid',
          data: { file: path.basename(context.filename) },
        });
      },
    };
  },
};
