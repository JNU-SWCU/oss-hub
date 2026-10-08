import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';
import typescriptParser from '@typescript-eslint/parser';
import noComments from '../../../eslint-rules/no-comments.mjs';

function eslint(rule, fix = false) {
  return new ESLint({
    fix,
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ['**/*.{ts,tsx}'],
        linterOptions: { noInlineConfig: true },
        languageOptions: {
          parser: typescriptParser,
          parserOptions: { ecmaFeatures: { jsx: true } },
        },
        plugins: { local: { rules: { 'no-comments': rule } } },
        rules: { 'local/no-comments': 'error' },
      },
    ],
  });
}

describe.each([['shared', noComments]])('%s local/no-comments', (_, rule) => {
  it('일반·문서·도구 지시 주석을 모두 보고한다', async () => {
    const code =
      '// line\n/** doc */\n/* block */\n// @vitest-environment happy-dom\n// eslint-' +
      'disable local/no-comments\nconst value = 1;';
    const [result] = await eslint(rule).lintText(code, {
      filePath: 'sample.ts',
    });
    expect(
      result.messages.filter((m) => m.ruleId === 'local/no-comments'),
    ).toHaveLength(5);
  });

  it('shebang과 문자열·템플릿·정규식 안의 주석 표기는 보존한다', async () => {
    const code =
      '#!/usr/bin/env node\nconst url = "https://example.test/*x*/";\nconst template = `/* x */ // y`;\nconst regex = /https?:\\/\\//;';
    const [result] = await eslint(rule, true).lintText(code, {
      filePath: 'sample.ts',
    });
    expect(result.messages).toEqual([]);
    expect(result.output).toBeUndefined();
  });

  it.each([
    [
      'function f(a: number) { return/*x*/a; }',
      'function f(a: number) { return a; }',
    ],
    ['const value = 1/*x*/+/*y*/+2;', 'const value = 1 + +2;'],
    ['const value = 1; // x\n', 'const value = 1; \n'],
    ['function f() { return/*x\ny*/1; }', 'function f() { return\n1; }'],
    ['function f() { return/*x\r\ny*/1; }', 'function f() { return\r\n1; }'],
    [
      'const A = () => <div>{/* x */}<span />{/* y */}</div>;',
      'const A = () => <div><span /></div>;',
    ],
    [
      'const A = () => <>{/* x */ /* y */}<span /></>;',
      'const A = () => <><span /></>;',
    ],
  ])(
    'fixer가 토큰·개행을 보존하고 JSX 빈 컨테이너를 제거한다: %s',
    async (code, output) => {
      const [result] = await eslint(rule, true).lintText(code, {
        filePath: 'sample.tsx',
      });
      expect(result.messages).toEqual([]);
      expect(result.output).toBe(output);
    },
  );
});
