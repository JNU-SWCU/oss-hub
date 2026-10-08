export default {
  meta: {
    type: 'suggestion',
    fixable: 'code',
    schema: [],
    messages: { forbidden: '코드 주석은 허용하지 않는다.' },
  },
  create(context) {
    const sourceCode = context.sourceCode;
    return {
      Program() {
        for (const comment of sourceCode.getAllComments()) {
          if (comment.type === 'Shebang') continue;
          const node = sourceCode.getNodeByRangeIndex(comment.range[0]);
          const container =
            node?.type === 'JSXEmptyExpression' &&
            node.parent?.type === 'JSXExpressionContainer'
              ? node.parent
              : null;
          context.report({
            loc: comment.loc,
            messageId: 'forbidden',
            fix(fixer) {
              if (container) return fixer.remove(container);
              const [start, end] = comment.range;
              const lineBreaks = sourceCode.text
                .slice(start, end)
                .match(/\r\n|[\n\r\u2028\u2029]/g);
              const replacement = lineBreaks
                ? lineBreaks.join('')
                : start > 0 &&
                    end < sourceCode.text.length &&
                    !/\s/.test(sourceCode.text[start - 1]) &&
                    !/\s/.test(sourceCode.text[end])
                  ? ' '
                  : '';
              return fixer.replaceTextRange(comment.range, replacement);
            },
          });
        }
      },
    };
  },
};
