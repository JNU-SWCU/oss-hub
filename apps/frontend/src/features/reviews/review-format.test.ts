import { describe, expect, it } from 'vitest';

import { blockedReasonLabel, revisionContent } from './review-format';
import type { SubmissionRevision } from './types';

function revision(overrides: Partial<SubmissionRevision>): SubmissionRevision {
  return {
    number: 1,
    content: { type: 'TEXT', text: '제출 본문' },
    comment: null,
    submittedAt: '2026-09-27T01:00:00.000Z',
    files: [],
    review: null,
    ...overrides,
  };
}

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

// QA48 — 학생 제출 내용이 raw JSON으로 그대로 노출되던 결함.
// revisionContent는 서버 계약(TEXT/FILE)과 방어적 경로(string, 알 수 없는 값)를
// 모두 사람이 읽을 문서로 옮겨야 하고, 어떤 경로에서도 JSON을 흘리면 안 된다.
describe('revisionContent', () => {
  it('TEXT 유형은 본문 텍스트를 그대로 보여준다', () => {
    const value = revisionContent(
      revision({
        content: { type: 'TEXT', text: '이번 마일스톤 보고서입니다.' },
      }),
    );

    expect(value).toBe('이번 마일스톤 보고서입니다.');
  });

  it('FILE 유형은 본문 텍스트가 없으므로 빈 문자열을 반환한다', () => {
    const value = revisionContent(
      revision({ content: { type: 'FILE', fileId: 'file-1' } }),
    );

    expect(value).toBe('');
  });

  it('문자열 content는 그대로 반환한다', () => {
    const value = revisionContent(
      revision({ content: 'legacy-string-content' as never }),
    );

    expect(value).toBe('legacy-string-content');
  });

  it('알 수 없는 형태의 content는 JSON을 흘리지 않고 안내 문구를 반환한다', () => {
    const value = revisionContent(
      revision({ content: { repositoryUrl: 'https://example.com' } as never }),
    );

    expect(value).toBe('제출 내용을 표시할 수 없습니다.');
    expect(value).not.toContain('{');
    expect(value).not.toContain('repositoryUrl');
  });
});
