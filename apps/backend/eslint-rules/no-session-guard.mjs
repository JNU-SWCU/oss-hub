import path from 'node:path';

export const noSessionGuard = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      forbidden:
        '라우트 인증은 전역 AuthenticationGuard가 맡는다. SessionGuard를 만들거나 쓰지 않는다.',
    },
  },
  create(context) {
    const report = (node) => context.report({ node, messageId: 'forbidden' });
    return {
      Program(node) {
        if (path.basename(context.filename) === 'session.guard.ts')
          report(node);
      },
      Identifier(node) {
        if (node.name === 'SessionGuard') report(node);
      },
      ImportDeclaration(node) {
        if (/(^|\/)session\.guard$/.test(node.source.value))
          report(node.source);
      },
    };
  },
};
