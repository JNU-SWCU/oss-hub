import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';
import typescriptParser from '@typescript-eslint/parser';
import rules from './design-system.mjs';

async function lint(code, filePath = 'src/features/sample/sample.tsx') {
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ['**/*.{ts,tsx}'],
        languageOptions: {
          parser: typescriptParser,
          parserOptions: { ecmaFeatures: { jsx: true } },
        },
        plugins: { local: { rules } },
        rules: {
          'local/design-class-name-length': 'error',
          'local/design-no-hex-color': 'error',
          'local/design-no-raw-button': 'error',
        },
      },
    ],
  });
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.map((m) => m.ruleId);
}

describe('design-class-name-length (R-08a)', () => {
  it('121자 className 리터럴을 보고하고 120자는 통과시킨다', async () => {
    const long = 'a'.repeat(121);
    const edge = 'a'.repeat(120);
    expect(
      await lint(`export const A = () => <div className="${long}" />;`),
    ).toEqual(['local/design-class-name-length']);
    expect(
      await lint(`export const A = () => <div className={"${long}"} />;`),
    ).toEqual(['local/design-class-name-length']);
    expect(
      await lint(`export const A = () => <div className="${edge}" />;`),
    ).toEqual([]);
  });

  it('className이 아닌 긴 문자열과 cn() 인자는 대상이 아니다', async () => {
    const long = 'a'.repeat(121);
    expect(
      await lint(
        `export const A = () => <div title="${long}" className={cn("${'b'.repeat(60)}")} />;`,
      ),
    ).toEqual([]);
  });
});

describe('design-no-hex-color (R-08b)', () => {
  it('문자열·템플릿 리터럴의 hex 색과 --palette-* 참조를 보고한다', async () => {
    expect(await lint(`export const c = '#003399';`)).toEqual([
      'local/design-no-hex-color',
    ]);
    expect(await lint(`export const c = 'fill: #fff';`)).toEqual([
      'local/design-no-hex-color',
    ]);
    expect(await lint('export const c = `stroke: #00923fcc`;')).toEqual([
      'local/design-no-hex-color',
    ]);
    expect(await lint(`export const c = 'var(--palette-navy-600)';`)).toEqual([
      'local/design-no-hex-color',
    ]);
  });

  it('색이 아닌 # 문자열은 통과시킨다', async () => {
    expect(
      await lint(
        `export const c = ['#milestones', '#access', 'var(--primary)', '#12'];`,
      ),
    ).toEqual([]);
  });
});

describe('design-no-raw-button (R-38)', () => {
  it('날 <button>을 보고하고 Button 프리미티브는 통과시킨다', async () => {
    expect(
      await lint(`export const A = () => <button type="button">x</button>;`),
    ).toEqual(['local/design-no-raw-button']);
    expect(
      await lint(
        `export const A = () => <Button variant="ghost" size="icon" aria-label="x" />;`,
      ),
    ).toEqual([]);
  });
});
