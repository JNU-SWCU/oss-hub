import { describe, expect, it } from 'vitest';
import {
  programApplicantsHref,
  programApplicationDetailHref,
  programDocumentsHref,
  programEditHref,
  programMilestoneDocumentsHref,
  programNewHref,
  programSubmissionReviewHref,
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
    expect(programApplicantsHref('program:basic')).toBe(
      '/programs/program%3Abasic/applicants',
    );
    expect(programApplicationDetailHref('program:basic', 'app:1')).toBe(
      '/programs/program%3Abasic/applications/app%3A1',
    );
    expect(
      programSubmissionReviewHref('program:basic', 'sub:final/report'),
    ).toBe('/programs/program%3Abasic/submissions/sub%3Afinal%2Freport/review');
  });

  it('서류 수합 경로는 두 세그먼트를 모두 인코딩한다', () => {
    expect(programMilestoneDocumentsHref('program:basic', 'final/report')).toBe(
      '/programs/program%3Abasic/milestones/final%2Freport/documents',
    );
  });
});
