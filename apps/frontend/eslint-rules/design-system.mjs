const MAX_CLASS_NAME_LENGTH = 120;

const HEX_COLOR =
  /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9a-zA-Z_-])/;
const PALETTE_REFERENCE = /--palette-/;

export const designClassNameLength = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'docs/design.md R-08a — 120자를 넘는 className 문자열 리터럴을 금지한다',
    },
    schema: [],
    messages: {
      tooLong:
        'className 문자열이 {{length}}자다 — 120자를 넘으면 cva variant나 공용 컴포넌트로 옮긴다 (docs/design.md R-08a).',
    },
  },
  create(context) {
    function check(node) {
      if (
        typeof node.value === 'string' &&
        node.value.length > MAX_CLASS_NAME_LENGTH
      ) {
        context.report({
          node,
          messageId: 'tooLong',
          data: { length: String(node.value.length) },
        });
      }
    }
    return {
      'JSXAttribute[name.name="className"] > Literal': check,
      'JSXAttribute[name.name="className"] > JSXExpressionContainer > Literal':
        check,
    };
  },
};

export const designNoHexColor = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'docs/design.md R-08b — hex 색 리터럴과 --palette-* 직접 참조를 금지한다',
    },
    schema: [],
    messages: {
      hex: 'hex 색 {{value}} — semantic 토큰(text-*/bg-*/border-* 유틸리티, var(--…))을 쓴다 (docs/design.md R-08b).',
      palette:
        '`--palette-*` 직접 참조 — semantic 토큰을 쓴다 (docs/design.md R-08b).',
    },
  },
  create(context) {
    function check(node, text) {
      const hex = HEX_COLOR.exec(text);
      if (hex) {
        context.report({ node, messageId: 'hex', data: { value: hex[0] } });
        return;
      }
      if (PALETTE_REFERENCE.test(text)) {
        context.report({ node, messageId: 'palette' });
      }
    }
    return {
      Literal(node) {
        if (typeof node.value === 'string') check(node, node.value);
      },
      TemplateElement(node) {
        check(node, node.value.raw);
      },
    };
  },
};

export const designNoRawButton = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'docs/design.md R-38 — 날 <button> 대신 Button 프리미티브를 쓴다',
    },
    schema: [],
    messages: {
      raw: '날 <button> 대신 `Button`(@/components/ui/button)을 쓴다. 아이콘만이면 variant="ghost" size="icon"에 aria-label과 툴팁을 붙인다 (docs/design.md R-38).',
    },
  },
  create(context) {
    return {
      'JSXOpeningElement[name.name="button"]'(node) {
        context.report({ node, messageId: 'raw' });
      },
    };
  },
};

export default {
  'design-class-name-length': designClassNameLength,
  'design-no-hex-color': designNoHexColor,
  'design-no-raw-button': designNoRawButton,
};
