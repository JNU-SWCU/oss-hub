const otherApp = 'backend';

const crossAppPath =
  /(?:^|[\\/])backend[\\/]|(?:^|[\\/])apps[\\/]backend(?![\w.-])/;

function report(context, node, value) {
  if (crossAppPath.test(value)) {
    context.report({ node, messageId: 'forbidden', data: { value } });
  }
}

export const noCrossAppPath = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      forbidden:
        '프론트엔드는 백엔드 경로를 참조할 수 없다 ({{value}}). 두 앱은 서로의 파일을 읽거나 import하지 않는다.',
    },
  },
  create(context) {
    return {
      Literal(node) {
        if (typeof node.value === 'string') report(context, node, node.value);
      },
      TemplateElement(node) {
        report(context, node, node.value.cooked ?? node.value.raw);
      },
    };
  },
};

export const crossAppImportPatterns = [
  {
    group: [`**/${otherApp}/**`, `**/apps/${otherApp}/**`],
    message: '프론트엔드는 백엔드 소스를 import할 수 없다.',
  },
];
