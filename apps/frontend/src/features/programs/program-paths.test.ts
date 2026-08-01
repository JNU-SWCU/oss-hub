import { describe, expect, it } from 'vitest';
import {
  decodeRouteProgramId,
  programHref,
  programSubmissionHref,
  staffApplicationDetailHref,
  staffProgramHref,
} from './program-paths';

describe('program-paths', () => {
  it('staffApplicationDetailHref 는 #119 locked 경로를 인코딩한다', () => {
    expect(staffApplicationDetailHref('prog:a', 'app:b')).toBe(
      '/staff/programs/prog%3Aa/applications/app%3Ab',
    );
  });

  it('staffProgramHref 로 신청자 목록 경로를 만든다', () => {
    expect(staffProgramHref('program-1', '/applicants')).toBe(
      '/staff/programs/program-1/applicants',
    );
  });

  it('programHref 와 decode 가 seed id 의 콜론을 보존한다', () => {
    const href = programHref('seed:basic', '/apply');
    expect(href).toBe('/programs/seed%3Abasic/apply');
    expect(decodeRouteProgramId('seed%3Abasic')).toBe('seed:basic');
  });

  it('programSubmissionHref 는 프로그램과 마일스톤 ID를 한 번씩 인코딩한다', () => {
    expect(programSubmissionHref('seed:basic', 'milestone/final')).toBe(
      '/programs/seed%3Abasic?submission=milestone%2Ffinal',
    );
  });
});
