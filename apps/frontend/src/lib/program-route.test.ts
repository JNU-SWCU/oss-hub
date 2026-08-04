import { describe, expect, it } from 'vitest';
import {
  programMyDocsHref,
  programStatusHref,
  studentProgramSubmissionHref,
} from './program-route';

describe('program-route href helpers', () => {
  it('인코딩된 programId로 status·mydocs 경로를 만든다', () => {
    expect(programStatusHref('program:basic')).toBe(
      '/programs/program%3Abasic/status',
    );
    expect(programMyDocsHref('program:basic')).toBe(
      '/programs/program%3Abasic/mydocs',
    );
  });

  it('milestoneId가 있으면 milestoneId 쿼리를 붙인다', () => {
    expect(programStatusHref('program:basic', 'final/report')).toBe(
      '/programs/program%3Abasic/status?milestoneId=final%2Freport',
    );
    expect(programMyDocsHref('program:basic', 'final/report')).toBe(
      '/programs/program%3Abasic/mydocs?milestoneId=final%2Freport',
    );
  });

  it('legacy submission href는 유지한다', () => {
    expect(studentProgramSubmissionHref('program:basic', 'final/report')).toBe(
      '/programs/program%3Abasic?submission=final%2Freport',
    );
  });
});
