import path from 'node:path';

const roleFile = /^(.+)\.(service|repository|client|guard|interceptor)\.ts$/;
const genericWords = new Set([
  'rules',
  'rule',
  'helpers',
  'helper',
  'utils',
  'util',
  'common',
  'policy',
  'misc',
  'shared',
]);

export const noGenericRoleFileNames = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      generic:
        '{{file}}의 "{{word}}"는 계층도 개념도 아니다. 메서드는 그 개념을 소유한 서비스로 옮기고, 소유자가 없으면 개념 이름으로 만든다.',
    },
  },
  create(context) {
    return {
      Program(node) {
        const file = path.basename(context.filename);
        const role = roleFile.exec(file);
        if (!role) return;
        const word = role[1].split('-').find((part) => genericWords.has(part));
        if (word === undefined) return;
        context.report({ node, messageId: 'generic', data: { file, word } });
      },
    };
  },
};
