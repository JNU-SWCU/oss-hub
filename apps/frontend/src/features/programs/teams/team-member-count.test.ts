import { describe, expect, it } from 'vitest';
import { teamMemberCountText } from './team-member-count';

describe('teamMemberCountText', () => {
  it('최대 인원이 있으면 정원과 함께 보여 준다', () => {
    expect(
      teamMemberCountText({ memberCount: 2, minSize: 2, maxSize: 4 }),
    ).toEqual({ label: '2명', capacity: '정원 4명', shortage: null });
  });

  it('정원을 채운 팀도 같은 자리에 정원을 보여 준다', () => {
    expect(
      teamMemberCountText({ memberCount: 4, minSize: 2, maxSize: 4 }),
    ).toEqual({ label: '4명', capacity: '정원 4명', shortage: null });
  });

  it('최대 인원이 없으면 팀원 수만 보여 준다', () => {
    expect(teamMemberCountText({ memberCount: 3, minSize: 1 })).toEqual({
      label: '3명',
      capacity: null,
      shortage: null,
    });
  });

  it('혼자 참여하는 프로그램은 1/1명 대신 팀원 수만 보여 준다', () => {
    expect(
      teamMemberCountText({ memberCount: 1, minSize: 1, maxSize: 1 }),
    ).toEqual({ label: '1명', capacity: null, shortage: null });
  });

  it('최소 인원에 못 미치면 모자란 인원을 함께 알린다', () => {
    expect(
      teamMemberCountText({ memberCount: 1, minSize: 3, maxSize: 4 }),
    ).toEqual({
      label: '1명',
      capacity: '정원 4명',
      shortage: '최소 3명 · 2명 부족',
    });
  });

  it('최대 인원이 없어도 최소 인원 미달은 알린다', () => {
    expect(teamMemberCountText({ memberCount: 1, minSize: 2 })).toEqual({
      label: '1명',
      capacity: null,
      shortage: '최소 2명 · 1명 부족',
    });
  });

  it('최소 인원을 모르면 경고 없이 팀원 수만 보여 준다', () => {
    expect(teamMemberCountText({ memberCount: 2 })).toEqual({
      label: '2명',
      capacity: null,
      shortage: null,
    });
  });
});
