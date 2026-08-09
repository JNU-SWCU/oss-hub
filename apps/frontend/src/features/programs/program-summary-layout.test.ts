// 「프로그램 안내」 요약 줄의 **흐름 방식**을 지킨다(QA32).
//
// 이 줄에는 항목이 셋(주관기관·신청기간·유형) 있는데, 예전 넓은 화면 템플릿이
// `auto minmax(0,1fr) auto` 세 칸이라 가운데 `1fr`이 남는 폭을 통째로 먹고 셋째
// 항목을 카드 오른쪽 끝으로 밀어냈다. 실측(Chrome 1280×900,
// `/programs/program-capstone`): 「신청기간」 글자가 x=842에서 끝나는데 「유형」은
// x=1176에서 시작해 334px이 비었다 — 앞 두 항목 사이는 24px(`gap-x-6`)뿐이다.
// 「유형만 따로 떨어져 보인다」가 그 간격이다.
//
// 고친 뒤 같은 폭: 「주관기관」 x=288 · 「신청기간」 x=498(둘 다 그대로) ·
// 「유형」 x=866 — 신청기간 글자 끝(842)에서 24px 뒤다. 줄 수도 카드 높이도(196px)
// 변하지 않는다.
//
// ⚠ **칸을 고정한 grid로는 이 결함이 되돌아온다.** 세 항목을 칸에 배정하면 남는
// 폭을 어느 칸이 먹느냐의 문제가 되고, 실측에서 그 부작용이 두 번 나왔다 —
// `auto auto minmax(0,1fr)`은 1024px에서 긴 주관기관명이 들어오자 「유형」을 폭 0으로
// 찌그러뜨렸고(`minmax(0,auto)`로 바꿔도 같았다), 세 칸을 유지하면 셋째가 다시
// 오른쪽 끝으로 간다. 넓은 화면에서는 칸을 열지 않고 **흐르게 두고 필요하면 줄을
// 바꾸는** 것이 이 줄의 계약이다.
//
// 이 vitest 설정은 CSS를 평가하지 않으므로
// `features/consents/consent-policy-wide-layout.test.ts`와 같이 소스의 클래스를 읽는다.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const view = readFileSync(
  path.resolve(__dirname, './program-detail-view.tsx'),
  'utf-8',
);

/** `className="…"`에 담긴 클래스 목록만 뽑는다 — 주석의 낱말은 세지 않는다. */
function classLists(source: string): string[][] {
  return [...source.matchAll(/className="([^"]*)"/g)].map((match) =>
    match[1]!.split(/\s+/),
  );
}

/** 요약 줄 — `gap-x-6`으로 항목을 벌리는 그 줄 하나뿐이다. */
const summary = classLists(view).find((tokens) => tokens.includes('gap-x-6'));

if (!summary) {
  throw new Error('program-detail-view.tsx에서 요약 줄을 찾지 못했습니다');
}

/** `ProgramSummary`가 그 줄에 넣는 항목 이름. */
const SUMMARY_ITEMS = ['주관기관', '신청기간', '유형'] as const;

describe('프로그램 안내 요약 줄', () => {
  it('요약 줄에 항목이 셋 있다', () => {
    for (const item of SUMMARY_ITEMS) {
      expect(view).toContain(`<strong>${item}</strong>`);
    }
  });

  // 칸을 고정하면 남는 폭이 어느 칸으로 가느냐의 문제가 되고, 그 순간 셋째가
  // 오른쪽 끝으로 밀리거나 폭 0으로 찌그러진다(둘 다 실측했다).
  it('넓은 화면에서는 칸을 열지 않고 흐르게 둔다', () => {
    expect(summary).toContain('lg:flex');
    expect(summary.some((token) => /^lg:grid-cols-/.test(token))).toBe(false);
  });

  // 줄바꿈이 없으면 긴 주관기관명에서 셋이 한 줄에 갇혀 넘친다.
  it('폭이 모자라면 줄을 바꾼다', () => {
    expect(summary).toContain('lg:flex-wrap');
  });

  // flex 항목은 기본적으로 min-content 아래로 줄지 않는다 — 이게 없으면
  // 긴 값이 줄바꿈 대신 카드 밖으로 삐져나간다.
  it('각 항목이 자기 폭을 줄일 수 있다', () => {
    const items = classLists(view).filter((tokens) =>
      tokens.includes('break-words'),
    );
    expect(items.length).toBeGreaterThanOrEqual(SUMMARY_ITEMS.length);
    for (const tokens of items) {
      expect(tokens).toContain('min-w-0');
    }
  });

  // 좁은 화면은 손대지 않았다 — 375px 3줄 · 768px 2줄로 그대로다.
  it('좁은 화면 배치는 그대로 둔다', () => {
    expect(summary).toContain('grid');
    expect(summary).toContain('sm:grid-cols-2');
  });
});
