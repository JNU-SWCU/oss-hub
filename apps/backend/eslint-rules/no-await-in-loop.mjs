import { relative } from 'node:path';
import { builtinRules } from 'eslint/use-at-your-own-risk';

const base = builtinRules.get('no-await-in-loop');

function enclosingFunctionName(ancestors) {
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const node = ancestors[index];
    if (
      node.type === 'MethodDefinition' ||
      node.type === 'PropertyDefinition'
    ) {
      const owner = ancestors
        .slice(0, index)
        .reverse()
        .find(
          (candidate) =>
            candidate.type === 'ClassDeclaration' ||
            candidate.type === 'ClassExpression',
        );
      return `${owner?.id?.name ?? '<anonymous>'}.${node.key.name ?? '<computed>'}`;
    }
    if (node.type === 'FunctionDeclaration' && node.id) {
      return node.id.name;
    }
  }
  return '<module>';
}

export const noAwaitInLoop = {
  meta: {
    ...base.meta,
    messages: {
      ...base.meta.messages,
      staleEntry:
        'no-await-in-loop 허용 목록의 {{name}} 항목이 더 이상 반복문 안 await를 감싸지 않는다. 허용 목록에서 지운다.',
    },
    schema: [
      {
        type: 'object',
        additionalProperties: {
          type: 'object',
          additionalProperties: { type: 'string', minLength: 1 },
        },
      },
    ],
  },
  create(context) {
    const file = relative(context.cwd, context.filename);
    const allowed = context.options[0]?.[file] ?? {};
    const used = new Set();
    const filtered = Object.create(context, {
      report: {
        value(descriptor) {
          const name = enclosingFunctionName(
            context.sourceCode.getAncestors(descriptor.node),
          );
          if (Object.hasOwn(allowed, name)) {
            used.add(name);
            return;
          }
          context.report(descriptor);
        },
      },
    });
    const handlers = base.create(filtered);
    const baseExit = handlers['Program:exit'];
    return {
      ...handlers,
      'Program:exit'(node) {
        baseExit?.(node);
        for (const name of Object.keys(allowed)) {
          if (!used.has(name)) {
            context.report({ node, messageId: 'staleEntry', data: { name } });
          }
        }
      },
    };
  },
};
