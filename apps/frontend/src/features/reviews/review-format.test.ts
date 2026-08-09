import { describe, expect, it } from 'vitest';

import { blockedReasonLabel } from './review-format';

describe('blockedReasonLabel', () => {
  // #354 — 공개가 막힌 이유만 알려주면 교직원이 다음에 무엇을 할지 모른다.
  // 원인과 다음 행동이 같은 문장 안에 있어야 한다.
  it('저장소 준비 미완은 원인과 다음 행동을 함께 알려준다', () => {
    const label = blockedReasonLabel('REPOSITORY_NOT_READY');

    expect(label).toContain('저장소 생성이 아직 끝나지 않았습니다');
    expect(label).toContain('새로고침');
    // 옛 문구는 "저장소 준비가 완료되지 않았습니다."로 끝나 행동이 없었다.
    expect(label).not.toContain('저장소 준비가 완료되지 않았습니다');
  });

  it('알 수 없는 사유의 기본 안내도 확인할 조건을 구체적으로 알려준다', () => {
    const label = blockedReasonLabel('UNKNOWN_REASON');

    // 서버 게이트 네 개를 모두 짚어 준다 — 둘만 적으면 나머지 둘로 막힌 교직원이 헤맨다.
    expect(label).toContain('저장소 생성 상태');
    expect(label).toContain('저장소 공개 예정');
    expect(label).toContain('프로그램 종료일');
    expect(label).toContain('필수 마일스톤 승인');
    // 옛 문구는 "조건이 아직 충족되지 않았습니다."뿐이라 조건을 알 수 없었다.
    expect(label).not.toContain('저장소 공개 조건이 아직 충족되지 않았습니다');
  });

  it('필수 마일스톤 미승인은 기존 사유 매핑을 유지한다', () => {
    expect(blockedReasonLabel('REQUIRED_MILESTONES_NOT_APPROVED')).toBe(
      '모든 필수 마일스톤의 승인이 필요합니다.',
    );
  });
});
