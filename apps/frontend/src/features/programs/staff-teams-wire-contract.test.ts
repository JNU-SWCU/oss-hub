import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

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
    const requested = Number(/const PAGE_SIZE = (\d+);/.exec(pageSource)?.[1]);
    expect(requested).toBeGreaterThan(0);

    expect(requested).toBeLessThanOrEqual(max);
  });
});
