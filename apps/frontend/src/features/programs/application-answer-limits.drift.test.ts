import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { APPLICATION_ANSWER_MAX_LENGTHS } from './application-answer-limits';

const VALIDATOR_PATH = path.resolve(
  __dirname,
  '../../../../backend/src/programs/application-answers.validator.ts',
);
const source = readFileSync(VALIDATOR_PATH, 'utf-8');

function backendLimits(): Readonly<Record<string, number>> {
  return parseBackendLimits(source);
}

export function parseBackendLimits(
  source: string,
): Readonly<Record<string, number>> {
  const declaration = 'export const APPLICATION_ANSWER_MAX_LENGTHS = {';
  const start = source.indexOf(declaration);
  if (start === -1) {
    throw new Error(
      'application-answers.validator.ts에서 APPLICATION_ANSWER_MAX_LENGTHS 선언을 찾지 못했다',
    );
  }

  const afterDeclaration = source
    .slice(start + declaration.length)
    .replaceAll(/\/\*[\s\S]*?\*\//g, '')
    .replaceAll(/\/\/.*$/gm, '');
  const end = afterDeclaration.indexOf('} as const;');
  if (end === -1) {
    throw new Error(
      'APPLICATION_ANSWER_MAX_LENGTHS 의 닫는 `} as const;` 를 찾지 못했다',
    );
  }

  const limits: Record<string, number> = {};
  for (const rawLine of afterDeclaration.slice(0, end).split('\n')) {
    const line = rawLine.trim();
    if (line === '') continue;
    const entry = /^(\w+)\s*:\s*([\d_]+)\s*,$/.exec(line);
    if (entry === null) {
      throw new Error(
        `상한 선언에서 해석할 수 없는 줄을 만났다: ${line}\n` +
          '단순한 `키: 숫자,` 가 아니면 값이 갈라져도 못 잡으므로 실패로 처리한다.',
      );
    }
    limits[entry[1]] = Number(entry[2].replaceAll('_', ''));
  }
  if (Object.keys(limits).length === 0) {
    throw new Error('백엔드 상한 값을 하나도 못 읽었다');
  }
  return limits;
}

describe('신청 항목 길이 상한이 backend와 어긋나지 않는다', () => {
  it('키와 값이 양쪽에서 같다', () => {
    expect(APPLICATION_ANSWER_MAX_LENGTHS).toEqual(backendLimits());
  });
});

describe('상한 선언 파서 — 읽지 못한 것은 실패로 처리한다', () => {
  const wrap = (body: string) =>
    `export const APPLICATION_ANSWER_MAX_LENGTHS = {\n${body}\n} as const;\n`;

  it('단순한 키: 숫자 목록은 읽는다', () => {
    expect(
      parseBackendLimits(wrap('  title: 200,\n  summary: 10_000,')),
    ).toEqual({ title: 200, summary: 10_000 });
  });

  it('spread 로 값을 덮어쓰면 통과시키지 않는다', () => {
    expect(() =>
      parseBackendLimits(
        wrap('  title: 200,\n  summary: 10_000,\n  ...OVERRIDE,'),
      ),
    ).toThrow(/해석할 수 없는 줄/);
  });

  it('계산된 키도 통과시키지 않는다', () => {
    expect(() =>
      parseBackendLimits(wrap("  ['title']: 201,\n  summary: 10_000,")),
    ).toThrow(/해석할 수 없는 줄/);
  });

  it('표현식으로 쓴 값도 통과시키지 않는다', () => {
    expect(() =>
      parseBackendLimits(wrap('  title: 100 * 2,\n  summary: 10_000,')),
    ).toThrow(/해석할 수 없는 줄/);
  });

  it('주석 안에 숨긴 닫는 표식에 속지 않는다', () => {
    const source = wrap(
      '  // 옛 값: } as const;\n  title: 200,\n  summary: 10_000,',
    );
    expect(parseBackendLimits(source)).toEqual({ title: 200, summary: 10_000 });
  });
});
