import { describe, expect, it } from 'vitest';
import {
  documentsStageSearch,
  programDocumentsHref,
  programEditHref,
  programApplyHref,
  programMyTeamHref,
  programNewHref,
  programSubmissionReviewHref,
  programTeamDetailHref,
} from './program-route';

describe('program-route href helpers', () => {
  it('역할과 무관한 documents 경로를 만든다', () => {
    expect(programDocumentsHref('program:basic')).toBe(
      '/programs/program%3Abasic/documents',
    );
  });

  it('milestoneId가 있으면 milestoneId 쿼리를 붙인다', () => {
    expect(programDocumentsHref('program:basic', 'final/report')).toBe(
      '/programs/program%3Abasic/documents?milestoneId=final%2Freport',
    );
  });

  it('프로그램 생성 경로를 만든다', () => {
    expect(programNewHref()).toBe('/programs/new');
  });

  it('인코딩된 programId로 편집·신청자·신청 상세·리뷰 경로를 만든다', () => {
    expect(programEditHref('program:basic')).toBe(
      '/programs/program%3Abasic/edit',
    );
    expect(
      programSubmissionReviewHref('program:basic', 'sub:final/report'),
    ).toBe('/programs/program%3Abasic/submissions/sub%3Afinal%2Freport/review');
  });

  it('우리 팀 경로는 programId를 인코딩한다', () => {
    expect(programMyTeamHref('program:basic')).toBe(
      '/programs/program%3Abasic/team',
    );
    expect(programMyTeamHref('a/b')).toBe('/programs/a%2Fb/team');
  });

  it('우리 팀 경로는 신청·참여 팀 목록 어느 쪽도 아니다', () => {
    const href = programMyTeamHref('prog-1');

    expect(href).toBe('/programs/prog-1/team');
    expect(href).not.toContain('/apply');
    expect(href).not.toBe(programApplyHref('prog-1'));

    expect(href).not.toBe('/programs/prog-1/teams');
  });

  it('다른 단계로 옮길 때 앞 단계의 서류 선택·페이지를 버린다', () => {
    expect(
      documentsStageSearch(
        'milestoneId=m1&documentId=d1&submissionState=MISSING&page=3&q=hong',
        'm2',
      ),
    ).toBe('milestoneId=m2&q=hong');
  });

  it('같은 단계를 가리킬 때는 서류 선택·페이지를 그대로 둔다', () => {
    expect(
      documentsStageSearch('milestoneId=m1&documentId=d1&page=3', 'm1'),
    ).toBe('milestoneId=m1&documentId=d1&page=3');
  });

  it('모든 단계로 돌아갈 때도 단계에 매인 쿼리만 버린다', () => {
    expect(
      documentsStageSearch('milestoneId=m1&documentId=d1&page=2&q=hong', null),
    ).toBe('q=hong');
  });

  it('팀 상세 경로는 programId와 teamId를 인코딩한다', () => {
    expect(programTeamDetailHref('program:basic', 'team/a')).toBe(
      '/programs/program%3Abasic/teams/team%2Fa',
    );
  });
});
