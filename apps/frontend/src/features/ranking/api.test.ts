import { expect, test } from 'vitest';
import {
  parseRankingPage,
  parseRankingTimeline,
  parseRankingYears,
  RankingResponseError,
} from './api';
import { RANKING_YEAR_ALL } from './types';

const rankingPage = (year: number | typeof RANKING_YEAR_ALL) => ({
  year,
  items: [
    {
      rank: 1,
      displayName: 'mina',
      githubLogin: 'mina',
      department: null,
      commitCount: 2,
      pullRequestCount: 1,
      issueCount: 3,
      repositoryCount: 4,
      starCount: 5,
      total: 15,
    },
  ],
  page: 1,
  pageSize: 20,
  total: 1,
  dataAsOf: null,
  viewerClass: 'public' as const,
  nextCycleAt: null,
});

test.each([RANKING_YEAR_ALL, 2025, 2026] as const)(
  'year=%s 공개 랭킹 응답을 화면 계약으로 변환한다',
  (year) => {
    expect(parseRankingPage(rankingPage(year))).toMatchObject({
      year,
      items: [
        {
          rank: 1,
          githubLogin: 'mina',
          commitCount: 2,
          pullRequestCount: 1,
        },
      ],
      total: 1,
      dataAsOf: null,
    });
  },
);

test('모르는 필드가 섞여도 파싱한다 — 봉투와 항목 양쪽', () => {
  const base = rankingPage(2026);
  const page = parseRankingPage({
    ...base,
    futureField: 'x',
    items: [{ ...base.items[0], futureField: 'x', releaseCount: 9 }],
  });

  expect(page.items[0]).toEqual({
    rank: 1,
    previousRank: null,
    githubLogin: 'mina',
    commitCount: 2,
    pullRequestCount: 1,
    issueCount: 3,
    repositoryCount: 4,
    starCount: 5,
    total: 15,
  });
  expect(page.viewerClass).toBe('public');
  expect(page.nextCycleAt).toBeNull();
});

test('TOP 10 항목의 선택적 연속 기록을 파싱한다', () => {
  const base = rankingPage(2026);
  const page = parseRankingPage({
    ...base,
    items: [
      {
        ...base.items[0],
        streak: {
          rankHeldSince: '2025-10-15',
          top10Since: '2025-09-01',
          rankHeldDays: 400,
          top10Days: 444,
        },
      },
    ],
  });

  expect(page.items[0]).toHaveProperty('streak', {
    rankHeldSince: '2025-10-15',
    top10Since: '2025-09-01',
    rankHeldDays: 400,
    top10Days: 444,
  });
});

test('11위 이하의 연속 기록과 잘못된 날짜 형식을 거부한다', () => {
  const base = rankingPage(2026);

  expect(() =>
    parseRankingPage({
      ...base,
      items: [
        {
          ...base.items[0],
          rank: 11,
          streak: {
            rankHeldSince: '2025-10-15',
            top10Since: '2025-09-01',
            rankHeldDays: 1,
            top10Days: 1,
          },
        },
      ],
    }),
  ).toThrow(RankingResponseError);
  expect(() =>
    parseRankingPage({
      ...base,
      items: [
        {
          ...base.items[0],
          streak: {
            rankHeldSince: '15-10-2025',
            top10Since: '2025-09-01',
            rankHeldDays: 1,
            top10Days: 1,
          },
        },
      ],
    }),
  ).toThrow(RankingResponseError);
});

test('구식 응답의 notice·period 같은 잔여 필드도 그냥 무시한다', () => {
  const page = parseRankingPage({
    ...rankingPage(2026),
    notice: '본 랭킹은 공개 GitHub 활동량 집계이며 평가·시상과 무관합니다.',
    period: 'THIS_YEAR',
  });

  expect(page.items).toHaveLength(1);
});

test('public commit·PR 칸은 필수다', () => {
  const base = rankingPage(2026);
  const withoutCommit: Partial<(typeof base.items)[number]> = {
    ...base.items[0],
  };
  const withoutPr: Partial<(typeof base.items)[number]> = { ...base.items[0] };
  delete withoutCommit.commitCount;
  delete withoutPr.pullRequestCount;

  expect(() => parseRankingPage({ ...base, items: [withoutCommit] })).toThrow(
    RankingResponseError,
  );
  expect(() => parseRankingPage({ ...base, items: [withoutPr] })).toThrow(
    RankingResponseError,
  );
});

test('공개 허용 목록 밖 구식 지표는 읽지 않는다', () => {
  const page = parseRankingPage({
    ...rankingPage(2026),
    items: [
      {
        rank: 1,
        displayName: 'mina',
        githubLogin: 'mina',
        commitCount: 2,
        pullRequestCount: 1,
        releaseCount: 1,
        total: 4,
      },
    ],
  });

  expect(page.items[0]).toEqual({
    rank: 1,
    previousRank: null,
    githubLogin: 'mina',
    commitCount: 2,
    pullRequestCount: 1,
    issueCount: 0,
    repositoryCount: 0,
    starCount: 0,
    total: 4,
  });
  expect(page.items[0]).not.toHaveProperty('releaseCount');
});

test('member 항목은 지표 여덟 칸을 읽고 빠진 지표는 0 으로 떨어뜨린다', () => {
  const base = rankingPage(2026);
  const full = parseRankingPage({ ...base, viewerClass: 'member' });
  const sparse = parseRankingPage({
    ...base,
    viewerClass: 'member',
    items: [
      { rank: 1, githubLogin: 'mina', commitCount: 2, pullRequestCount: 1 },
    ],
  });

  expect(full.viewerClass).toBe('member');
  expect(full.items[0]).toEqual({
    rank: 1,
    previousRank: null,
    githubLogin: 'mina',
    commitCount: 2,
    pullRequestCount: 1,
    issueCount: 3,
    repositoryCount: 4,
    starCount: 5,
    total: 15,
  });
  expect(sparse.items[0]).toHaveProperty('total', 0);

  for (const identity of ['name', 'department', 'displayName']) {
    expect(full.items[0]).not.toHaveProperty(identity);
  }
});

test('member 항목에 name 키가 있으면 거부한다 — 신원 가드는 계층을 타지 않는다', () => {
  const base = rankingPage(2026);
  expect(() =>
    parseRankingPage({
      ...base,
      viewerClass: 'member',
      items: [{ ...base.items[0], name: 'synthetic-staff-name' }],
    }),
  ).toThrow(RankingResponseError);
});

test('필수 필드는 형이 어긋나면 계속 거부한다', () => {
  const base = rankingPage(2026);

  expect(() =>
    parseRankingPage({ ...base, items: [{ ...base.items[0], rank: '1' }] }),
  ).toThrow(RankingResponseError);

  expect(() =>
    parseRankingPage({
      ...base,
      items: [{ ...base.items[0], githubLogin: 42 }],
    }),
  ).toThrow(RankingResponseError);

  expect(() =>
    parseRankingPage({
      ...base,
      items: [{ ...base.items[0], pullRequestCount: '1' }],
    }),
  ).toThrow(RankingResponseError);

  expect(() =>
    parseRankingPage({
      ...base,
      items: [{ ...base.items[0], commitCount: '2' }],
    }),
  ).toThrow(RankingResponseError);
});

test('봉투 필수 필드가 없거나 형이 어긋나면 거부한다', () => {
  expect(() => parseRankingPage({ year: RANKING_YEAR_ALL, items: [] })).toThrow(
    RankingResponseError,
  );
  expect(() => parseRankingPage({ ...rankingPage(2026), page: '1' })).toThrow(
    RankingResponseError,
  );
  expect(() => parseRankingPage({ ...rankingPage(2026), items: null })).toThrow(
    RankingResponseError,
  );
  expect(() =>
    parseRankingPage({ ...rankingPage(2026), items: { 0: 'nope' } }),
  ).toThrow(RankingResponseError);
});

test('staff 학과는 문자열이면 그대로 읽고, 없거나 비어 있으면 null 로 떨어뜨린다', () => {
  const base = rankingPage(2026);
  const read = (department: unknown) => {
    const page = parseRankingPage({
      ...base,
      viewerClass: 'staff',
      items: [{ ...base.items[0], department }],
    });
    if (page.viewerClass !== 'staff') {
      throw new TypeError('staff fixture parsed as public');
    }
    return page.items[0]?.department;
  };

  expect(read('소프트웨어공학과')).toBe('소프트웨어공학과');
  expect(read('  인공지능학부  ')).toBe('인공지능학부');
  expect(read(null)).toBeNull();
  expect(read(undefined)).toBeNull();
  expect(read('   ')).toBeNull();

  expect(read(42)).toBeNull();
});

test('연도 목록 응답을 파싱하고 모르는 필드는 무시한다', () => {
  expect(parseRankingYears({ years: [2026, 2025] })).toEqual({
    years: [2026, 2025],
  });
  expect(parseRankingYears({ years: [2026], extra: true })).toEqual({
    years: [2026],
  });
  expect(() => parseRankingYears({ years: ['2026'] })).toThrow(
    RankingResponseError,
  );
});

test('dataAsOf 가 없어도 파싱된다', () => {
  const withoutDataAsOf: Partial<ReturnType<typeof rankingPage>> =
    rankingPage(2026);
  delete withoutDataAsOf.dataAsOf;
  expect(parseRankingPage(withoutDataAsOf).dataAsOf).toBeNull();
});

test('dataAsOf 가 오면 Date 로 정규화한다', () => {
  const page = parseRankingPage({
    ...rankingPage(2026),
    dataAsOf: '2026-08-09T00:00:00.000Z',
  });
  expect(page.dataAsOf?.toISOString()).toBe('2026-08-09T00:00:00.000Z');
});

test('dataAsOf 가 null 이어도 받아들인다 — 관측이 아직 없는 상태', () => {
  expect(parseRankingPage(rankingPage(2026)).dataAsOf).toBeNull();
});

test('dataAsOf 가 날짜가 아니면 거부한다', () => {
  expect(() =>
    parseRankingPage({ ...rankingPage(2026), dataAsOf: 'not-a-date' }),
  ).toThrow(RankingResponseError);
});

test('viewerClass 가 없으면 거부한다', () => {
  const withoutViewerClass: Partial<ReturnType<typeof rankingPage>> =
    rankingPage(2026);
  delete withoutViewerClass.viewerClass;
  expect(() => parseRankingPage(withoutViewerClass)).toThrow(
    RankingResponseError,
  );
});

test('viewerClass 가 public|member|staff 가 아니면 거부한다', () => {
  expect(() =>
    parseRankingPage({ ...rankingPage(2026), viewerClass: 'STUDENT' }),
  ).toThrow(RankingResponseError);
  expect(() =>
    parseRankingPage({ ...rankingPage(2026), viewerClass: 'ADMIN' }),
  ).toThrow(RankingResponseError);
});

test('public 항목은 지표 아홉 키만 남기고 staff 항목은 richer shape을 유지한다', () => {
  const base = rankingPage(2026);
  const publicPage = parseRankingPage(base);
  const staffPage = parseRankingPage({
    ...base,
    viewerClass: 'staff',
    items: [{ ...base.items[0], name: 'synthetic-staff-name' }],
  });

  expect(Object.keys(publicPage.items[0] ?? {}).sort()).toEqual([
    'commitCount',
    'githubLogin',
    'issueCount',
    'previousRank',
    'pullRequestCount',
    'rank',
    'repositoryCount',
    'starCount',
    'total',
  ]);

  for (const identity of ['name', 'department', 'displayName']) {
    expect(publicPage.items[0]).not.toHaveProperty(identity);
  }
  expect(staffPage.items[0]).toEqual({
    rank: 1,
    previousRank: null,
    githubLogin: 'mina',
    name: 'synthetic-staff-name',
    department: null,
    commitCount: 2,
    pullRequestCount: 1,
    issueCount: 3,
    repositoryCount: 4,
    starCount: 5,
    total: 15,
  });
});

test('nextCycleAt 이 없어도 파싱되고 null 로 떨어진다', () => {
  const withoutNextCycleAt: Partial<ReturnType<typeof rankingPage>> =
    rankingPage(2026);
  delete withoutNextCycleAt.nextCycleAt;
  expect(parseRankingPage(withoutNextCycleAt).nextCycleAt).toBeNull();
});

test('nextCycleAt 이 ISO 이면 문자열로 유지한다', () => {
  const page = parseRankingPage({
    ...rankingPage(2026),
    nextCycleAt: '2026-08-20T10:00:00.000Z',
  });
  expect(page.nextCycleAt).toBe('2026-08-20T10:00:00.000Z');
});

test('nextCycleAt 이 날짜가 아니면 거부한다', () => {
  expect(() =>
    parseRankingPage({ ...rankingPage(2026), nextCycleAt: 'soon' }),
  ).toThrow(RankingResponseError);
});

test('public 항목에 name 키가 있으면 거부한다', () => {
  const base = rankingPage(2026);
  expect(() =>
    parseRankingPage({
      ...base,
      viewerClass: 'public',
      items: [{ ...base.items[0], name: 'synthetic-staff-name' }],
    }),
  ).toThrow(RankingResponseError);
});

test('staff 항목의 name 은 문자열 또는 null 이다', () => {
  const base = rankingPage(2026);
  const parseStaff = (items: readonly unknown[] = base.items) => {
    const page = parseRankingPage({
      ...base,
      viewerClass: 'staff',
      items,
    });
    if (page.viewerClass !== 'staff') {
      throw new TypeError('staff fixture parsed as public');
    }
    return page;
  };
  const withName = parseStaff([
    { ...base.items[0], name: 'synthetic-staff-name' },
  ]);
  expect(withName.items[0]?.name).toBe('synthetic-staff-name');

  const withNull = parseStaff([{ ...base.items[0], name: null }]);
  expect(withNull.items[0]?.name).toBeNull();

  const omitted = parseStaff();
  expect(omitted.items[0]?.name).toBeNull();
});

test('타임라인은 월과 계열을 읽고, 계열 길이가 월 수와 다르면 거부한다', () => {
  const series = { githubLogin: 'mina', ranks: [null, 1], totals: [null, 40] };

  expect(
    parseRankingTimeline({ year: 2026, months: [1, 2], series: [series] }),
  ).toEqual({ year: 2026, months: [1, 2], series: [series] });
  expect(() =>
    parseRankingTimeline({ year: 2026, months: [1], series: [series] }),
  ).toThrow(RankingResponseError);
});

test('전체 타임라인은 실제 월 범위와 관측값이 없는 구간을 유지한다', () => {
  const timeline = {
    year: RANKING_YEAR_ALL,
    periods: [
      { fromMonth: '2025-11', toMonth: '2026-01' },
      { fromMonth: '2026-02', toMonth: '2026-04' },
      { fromMonth: '2026-05', toMonth: '2026-05' },
    ],
    series: [
      { githubLogin: 'mina', ranks: [1, null, 1], totals: [5, null, 40] },
    ],
  };

  expect(parseRankingTimeline(timeline)).toEqual(timeline);
  expect(() =>
    parseRankingTimeline({ ...timeline, periods: timeline.periods.slice(1) }),
  ).toThrow(RankingResponseError);
});
