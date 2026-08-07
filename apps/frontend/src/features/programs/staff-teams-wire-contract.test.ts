import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 교직원 참여 팀 화면이 backend 계약을 넘지 않는지 검사한다.
 *
 * 이 화면은 신청 목록을 페이지로 나눠 받는데, 한 페이지 크기가 backend
 * `ApplicationListQueryRequestDto` 의 `@Max` 를 넘으면 `ValidationPipe` 가 요청 전체를
 * 400 SYS_003 으로 거절한다. 화면에는 "참여 팀을 불러오지 못했습니다"만 뜨고 원인은
 * 안 보인다 — 2026-08-05 신청 제출 회귀(#700)와 정확히 같은 종류의 사고다.
 *
 * 그래서 상한을 손으로 적지 않고 **backend DTO 소스에서 읽어** 대조한다. 기대값을
 * 베껴 두면 backend 가 상한을 낮췄을 때 이 검사가 같이 낡는다.
 *
 * 이 파일은 기본 `node` 환경이다 — happy-dom 에서는 `import.meta.url` 이 file: 스킴이
 * 아니라 소스를 읽을 수 없다.
 */
const QUERY_DTO_PATH = fileURLToPath(
  new URL(
    '../../../../backend/src/applications/dto/application-list-query.dto.ts',
    import.meta.url,
  ),
);
const PAGE_SOURCE_PATH = fileURLToPath(
  new URL('./program-staff-teams-page.tsx', import.meta.url),
);

describe('교직원 참여 팀 화면의 신청 목록 요청', () => {
  it('한 페이지 크기가 backend 상한을 넘지 않는다', () => {
    const dtoSource = readFileSync(QUERY_DTO_PATH, 'utf8');
    const max = Number(/@Max\((\d+)\)/.exec(dtoSource)?.[1]);
    expect(max).toBeGreaterThan(0);

    const pageSource = readFileSync(PAGE_SOURCE_PATH, 'utf8');
    const requested = Number(
      /const APPLICATION_PAGE_SIZE = (\d+);/.exec(pageSource)?.[1],
    );
    expect(requested).toBeGreaterThan(0);

    expect(requested).toBeLessThanOrEqual(max);
  });
});
