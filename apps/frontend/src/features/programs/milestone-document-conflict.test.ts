import { describe, expect, it } from 'vitest';
import { ApiError, type ProblemDetail } from '@/lib/api-client';
import {
  isMilestoneDocumentSubmitReviewChanged,
  milestoneDocumentReviewConflictNotice,
  milestoneDocumentReviewConflictOf,
  milestoneDocumentSubmitConflictNotice,
} from './milestone-document-conflict';

function problem(code: string, status: number, detail = '충돌'): ProblemDetail {
  return {
    type: 'about:blank',
    title: 'Conflict',
    status,
    detail,
    instance: '/x',
    code,
  };
}

function apiError(code: string, status = 409): ApiError {
  return new ApiError(problem(code, status));
}

describe('판정 실패가 「표가 낡았다」인지 가리기', () => {
  it('제출물이 바뀐 409(MSD_025)는 다른 충돌과 갈라 본다', () => {
    expect(milestoneDocumentReviewConflictOf(apiError('MSD_025'))).toBe(
      'target-changed',
    );
  });

  it('다른 판정이 먼저 등록된 409(MSD_024)와 제출이 사라진 404(MSD_022)도 표를 다시 부른다', () => {
    expect(milestoneDocumentReviewConflictOf(apiError('MSD_024'))).toBe(
      'review-changed',
    );
    expect(milestoneDocumentReviewConflictOf(apiError('MSD_022', 404))).toBe(
      'submission-missing',
    );
  });

  it('사유 필수 422와 ApiError가 아닌 실패는 다시 부를 일이 아니다', () => {
    expect(
      milestoneDocumentReviewConflictOf(apiError('MSD_021', 422)),
    ).toBeNull();
    expect(
      milestoneDocumentReviewConflictOf(new Error('네트워크 오류')),
    ).toBeNull();
    expect(milestoneDocumentReviewConflictOf(null)).toBeNull();
  });
});

describe('충돌 뒤 교직원에게 하는 말', () => {
  it('다시 불러왔을 때만 다시 불러왔다고 말한다', () => {
    const reloaded = milestoneDocumentReviewConflictNotice(
      'target-changed',
      'reloaded',
    );
    expect(reloaded).toContain('저장하지 않았습니다');
    expect(reloaded).toContain('다시 불러왔습니다');
    expect(reloaded).toContain('다시 확인한 뒤 다시 검토해 주세요');

    const failed = milestoneDocumentReviewConflictNotice(
      'target-changed',
      'failed',
    );
    expect(failed).toContain('저장하지 않았습니다');
    expect(failed).toContain('최신 표를 불러오지 못했습니다');
    expect(failed).not.toContain('다시 불러왔습니다');
  });

  it('최신 표 조회 실패와 다시 확인할 방법을 함께 안내한다', () => {
    const failed = milestoneDocumentReviewConflictNotice(
      'review-changed',
      'failed',
    );
    expect(failed).toContain('최신 표를 불러오지 못했습니다');
    expect(failed).toContain('다시 시도');
  });

  it('첫마디는 충돌마다 다르다', () => {
    expect(
      milestoneDocumentReviewConflictNotice('target-changed', 'failed'),
    ).toContain('제출물 또는 검토 결과가 바뀌어');
    expect(
      milestoneDocumentReviewConflictNotice('review-changed', 'failed'),
    ).toContain('다른 검토 결과가 먼저 등록되어');
    expect(
      milestoneDocumentReviewConflictNotice('submission-missing', 'failed'),
    ).toContain('검토하려던 제출을 찾지 못해');
  });

  it('학생에게 하는 서버 문구를 그대로 쓰지 않는다', () => {
    for (const result of ['reloaded', 'failed'] as const) {
      expect(
        milestoneDocumentReviewConflictNotice('target-changed', result),
      ).not.toContain('제출하는 사이에 판정이 등록되었습니다');
    }
  });

  it('패널이 이미 말하고 있는 자리에는 문구를 겹치지 않는다', () => {
    expect(
      milestoneDocumentReviewConflictNotice('review-changed', 'reloaded'),
    ).toBeNull();
    expect(
      milestoneDocumentReviewConflictNotice('submission-missing', 'reloaded'),
    ).toBeNull();
  });

  it('버려진 재조회에는 할 말이 없다', () => {
    expect(
      milestoneDocumentReviewConflictNotice('target-changed', 'superseded'),
    ).toBeNull();
  });
});

describe('학생 제출이 판정과 부딪혔을 때', () => {
  it('MSD_024만 다시 부를 일로 본다', () => {
    expect(isMilestoneDocumentSubmitReviewChanged(apiError('MSD_024'))).toBe(
      true,
    );

    expect(isMilestoneDocumentSubmitReviewChanged(apiError('MSD_023'))).toBe(
      false,
    );
    expect(
      isMilestoneDocumentSubmitReviewChanged(apiError('MSD_002', 403)),
    ).toBe(false);
    expect(isMilestoneDocumentSubmitReviewChanged(new Error('끊김'))).toBe(
      false,
    );
  });

  it('서류 이름을 부르고, 다시 불러왔을 때만 다시 불러왔다고 말한다', () => {
    const reloaded = milestoneDocumentSubmitConflictNotice(
      '기획서',
      'reloaded',
    );
    expect(reloaded).toContain('「기획서」');
    expect(reloaded).toContain('저장되지 않았습니다');
    expect(reloaded).toContain('다시 불러왔습니다');

    const failed = milestoneDocumentSubmitConflictNotice('기획서', 'failed');
    expect(failed).toContain('저장되지 않았습니다');
    expect(failed).toContain('다시 불러오지 못했습니다');
    expect(failed).not.toContain('다시 불러왔습니다');
  });

  it('교직원 문구와 첫마디가 다르다', () => {
    expect(
      milestoneDocumentSubmitConflictNotice('기획서', 'reloaded'),
    ).not.toContain('검토하는 사이에');
    expect(
      milestoneDocumentSubmitConflictNotice('기획서', 'reloaded'),
    ).toContain('제출하는 사이에');
  });
});
