import { describe, expect, it } from 'vitest';
import type { TeamActivityMember } from './team-activity-api';
import { weeklyActivity } from './team-activity-weeks';

const NOW = Date.parse('2026-09-24T03:00:00Z'); // 2026-09-24(목) 12:00 KST

function member(
  userId: string,
  points: readonly (readonly [string, number])[],
): TeamActivityMember {
  const commitCount = points.reduce((sum, [, commits]) => sum + commits, 0);
  return {
    userId,
    githubLogin: `${userId}-login`,
    totals: { commitCount, pullRequestCount: 0, issueCount: 0 },
    points: points.map(([date, commits]) => ({
      date,
      commitCount: commits,
      pullRequestCount: 0,
      issueCount: 0,
    })),
  };
}

function activityWindow(from: string, to: string) {
  return { from, to, timeZone: 'Asia/Seoul' as const };
}

describe('weeklyActivity', () => {
  it('일요일과 다음 월요일을 서로 다른 월–일 주로 묶는다', () => {
    const result = weeklyActivity(
      {
        window: activityWindow('2026-09-14', '2026-09-27'),
        members: [
          member('a', [
            ['2026-09-14', 1],
            ['2026-09-20', 2],
            ['2026-09-21', 4],
          ]),
        ],
      },
      NOW,
    );

    expect(result.weeks).toEqual(['2026-09-14', '2026-09-21']);
    expect(result.members[0]?.weeks.map((week) => week.commitCount)).toEqual([
      3, 4,
    ]);
  });

  it('오늘과 창의 끝을 서울 날짜로 읽는다 — UTC 일요일 밤은 서울 월요일이다', () => {
    const sundayNightUtc = Date.parse('2026-09-20T15:30:00Z'); // 09-21(월) 00:30 KST

    const byNow = weeklyActivity(
      { window: activityWindow('2026-09-14', '9999-12-31'), members: [] },
      sundayNightUtc,
    );
    const byWindowEnd = weeklyActivity(
      {
        window: activityWindow('2026-09-14', '2026-09-20T15:30:00.000Z'),
        members: [],
      },
      NOW,
    );

    expect(byNow.weeks).toEqual(['2026-09-14', '2026-09-21']);
    expect(byWindowEnd.weeks).toEqual(['2026-09-14', '2026-09-21']);
  });

  it('센티널 창은 첫 기여부터 오늘까지로 좁힌다', () => {
    const result = weeklyActivity(
      {
        window: activityWindow('0001-01-01', '+010000-01-01'),
        members: [
          member('a', [['2026-09-02', 1]]),
          member('b', [['2026-09-16', 2]]),
        ],
      },
      NOW,
    );

    expect(result.weeks).toEqual([
      '2026-08-31',
      '2026-09-07',
      '2026-09-14',
      '2026-09-21',
    ]);
  });

  it('센티널 창에 기여가 없으면 이번 주 하나만 그린다', () => {
    const result = weeklyActivity(
      {
        window: activityWindow('0001-01-01', '9999-12-31T23:59:59.999Z'),
        members: [member('a', [])],
      },
      NOW,
    );

    expect(result.weeks).toEqual(['2026-09-21']);
    expect(result.members[0]?.weeks).toEqual([
      { commitCount: 0, pullRequestCount: 0, issueCount: 0 },
    ]);
  });

  it('끝난 프로그램은 창의 끝에서 멈추고, 진행 중이면 오지 않은 주를 그리지 않는다', () => {
    const ended = weeklyActivity(
      { window: activityWindow('2026-08-03', '2026-08-16'), members: [] },
      NOW,
    );
    const running = weeklyActivity(
      { window: activityWindow('2026-09-14', '2026-12-31'), members: [] },
      NOW,
    );

    expect(ended.weeks).toEqual(['2026-08-03', '2026-08-10']);
    expect(running.weeks).toEqual(['2026-09-14', '2026-09-21']);
  });

  it('받은 기여는 오늘 뒤라도 버리지 않고 구간을 넓힌다', () => {
    const result = weeklyActivity(
      {
        window: activityWindow('2026-09-21', '2026-10-31'),
        members: [member('a', [['2026-09-28', 5]])],
      },
      NOW,
    );

    expect(result.weeks).toEqual(['2026-09-21', '2026-09-28']);
    expect(result.members[0]?.weeks.map((week) => week.commitCount)).toEqual([
      0, 5,
    ]);
  });

  it('기여가 없는 팀원도 목록에 남기되 선은 긋지 않도록 표시한다', () => {
    const result = weeklyActivity(
      {
        window: activityWindow('2026-09-14', '2026-09-27'),
        members: [member('a', [['2026-09-15', 1]]), member('b', [])],
      },
      NOW,
    );

    expect(
      result.members.map(({ member: item, contributed }) => [
        item.userId,
        contributed,
      ]),
    ).toEqual([
      ['a', true],
      ['b', false],
    ]);
  });
});
