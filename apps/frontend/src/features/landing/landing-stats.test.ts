import { describe, expect, it } from 'vitest';
import { deriveLandingStats } from './landing-stats';

describe('landing statistics', () => {
  it('omits only the contributor item for a sample without contributors', () => {
    expect(
      deriveLandingStats({
        programCount: 1,
        repositoryCount: 2,
        contributorCount: 0,
      }),
    ).toEqual({
      items: [
        { key: '공개 프로그램', value: '1' },
        { key: '공개 저장소', value: '2' },
      ],
      note: '공개 프로젝트 기준',
    });
  });
  it('omits counts and note when projects are empty', () => {
    expect(
      deriveLandingStats({
        programCount: 0,
        repositoryCount: 0,
        contributorCount: 0,
      }),
    ).toEqual({ items: [], note: null });
  });
});
