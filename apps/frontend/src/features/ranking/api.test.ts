import { expect, test } from 'vitest';
import {
  parseRankingPage,
  parseRankingYears,
  RankingResponseError,
} from './api';
import {
  currentRankingYear,
  RANKING_YEAR_ALL,
  parseRankingYearSearchParam,
  rankingListHref,
} from './types';

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
          commitCount: 2,
          pullRequestCount: 1,
          issueCount: 3,
          repositoryCount: 4,
          starCount: 5,
          total: 15,
        },
      ],
      total: 1,
      dataAsOf: null,
    });
  },
);

// 관용적 읽기 (Fowler tolerant reader).
//
// 백엔드가 칸을 늘리는 배포와 프런트 배포는 원자적이지 않다. 파서가 모르는
// 칸을 거부하면 그 틈에 랭킹 화면이 통째로 죽는다 — 예전 파서가 정확히
// 그랬다. 아래가 "모르는 것은 무시하고 쓰는 것만 본다"를 고정한다.

test('모르는 필드가 섞여도 파싱한다 — 봉투와 항목 양쪽', () => {
  const base = rankingPage(2026);
  const page = parseRankingPage({
    ...base,
    futureField: 'x',
    items: [{ ...base.items[0], futureField: 'x', releaseCount: 9 }],
  });

  expect(page.items[0]).toEqual({
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
  });
  expect(page.viewerClass).toBe('public');
  expect(page.nextCycleAt).toBeNull();
});

test('구식 응답의 notice·period 같은 잔여 필드도 그냥 무시한다', () => {
  const page = parseRankingPage({
    ...rankingPage(2026),
    notice: '본 랭킹은 공개 GitHub 활동량 집계이며 평가·시상과 무관합니다.',
    period: 'THIS_YEAR',
  });

  expect(page.items).toHaveLength(1);
});

test('지표 칸이 없으면 0으로, displayName 이 없으면 로그인으로 떨어진다', () => {
  const page = parseRankingPage({
    ...rankingPage(2026),
    items: [{ rank: 1, githubLogin: 'mina', total: 7 }],
  });

  expect(page.items[0]).toEqual({
    rank: 1,
    displayName: 'mina',
    githubLogin: 'mina',
    // 학과 칸이 없는 응답도 페이지를 버리지 않는다 — 화면이 대시로 채운다.
    department: null,
    commitCount: 0,
    pullRequestCount: 0,
    issueCount: 0,
    repositoryCount: 0,
    starCount: 0,
    total: 7,
  });
});

test('새 지표 칸이 없는 구식 항목도 0 으로 읽힌다 — 백엔드가 아직 안 바뀜 상태', () => {
  // 배포 틈에는 이전 계약(commit·PR·release)이 그대로 올 수 있다. 그때 화면은
  // 새 열을 0으로 그려야 하며 페이지 전체를 버리면 안 된다.
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
    displayName: 'mina',
    githubLogin: 'mina',
    department: null,
    commitCount: 2,
    pullRequestCount: 1,
    issueCount: 0,
    repositoryCount: 0,
    starCount: 0,
    total: 4,
  });
});

test('total 은 백엔드가 준 값을 그대로 쓴다 — 지표 합으로 검산하지 않는다', () => {
  // 지표 구성은 또 바뀔 수 있다. 화면이 합을 다시 내면 백엔드 판정을 프런트가
  // 재현하게 되고(ADR-008), 그때마다 화면이 먼저 깨진다.
  const base = rankingPage(2026);
  const page = parseRankingPage({
    ...base,
    items: [{ ...base.items[0], total: 99 }],
  });

  expect(page.items[0]?.total).toBe(99);
});

test('필수 필드는 형이 어긋나면 계속 거부한다', () => {
  const base = rankingPage(2026);

  // rank — 화면이 행 key 로 쓴다.
  expect(() =>
    parseRankingPage({ ...base, items: [{ ...base.items[0], rank: '1' }] }),
  ).toThrow(RankingResponseError);
  // githubLogin — 사람을 식별하는 유일한 칸.
  expect(() =>
    parseRankingPage({
      ...base,
      items: [{ ...base.items[0], githubLogin: 42 }],
    }),
  ).toThrow(RankingResponseError);
  // total — 합계 열.
  expect(() =>
    parseRankingPage({ ...base, items: [{ ...base.items[0], total: '4' }] }),
  ).toThrow(RankingResponseError);
  // 있으면서 형이 틀린 지표 칸은 기본값으로 감추지 않는다.
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

// 학과 칸 (owner 결정 2026-08-19 — 공개 계층에도 내려간다).

test('학과는 문자열이면 그대로 읽고, 없거나 비어 있으면 null 로 떨어뜨린다', () => {
  const base = rankingPage(2026);
  const read = (department: unknown) =>
    parseRankingPage({
      ...base,
      items: [{ ...base.items[0], department }],
    }).items[0]?.department;

  expect(read('소프트웨어공학과')).toBe('소프트웨어공학과');
  expect(read('  인공지능학부  ')).toBe('인공지능학부');
  expect(read(null)).toBeNull();
  expect(read(undefined)).toBeNull();
  expect(read('   ')).toBeNull();
  // 형이 어긋나도 페이지를 버리지 않는다 — 화면은 대시로 성립한다.
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

test('URL year 파싱과 href 생성', () => {
  expect(parseRankingYearSearchParam('2025')).toBe(2025);
  // 값이 없으면 올해다 — 백엔드 기본과 같은 규칙이라야 링크 없이 연 화면과
  // 서버가 같은 것을 본다(ADR-010 §1).
  expect(parseRankingYearSearchParam(null)).toBe(currentRankingYear());
  expect(parseRankingYearSearchParam('')).toBe(currentRankingYear());
  // 전체 누적은 명시했을 때만이다.
  expect(parseRankingYearSearchParam('all')).toBe(RANKING_YEAR_ALL);
  // 알 수 없는 값도 전체가 아니라 올해로 떨어뜨린다 — 기본이 바뀌었으므로
  // 실수한 링크가 조용히 전체 누적을 여는 일이 없어야 한다.
  expect(parseRankingYearSearchParam('nope')).toBe(currentRankingYear());
  expect(rankingListHref(RANKING_YEAR_ALL)).toBe('/ranking?year=all');
  expect(rankingListHref(2025)).toBe('/ranking?year=2025');
});

// 갱신 시각 봉투 (ADR-010 §10).

test('dataAsOf 가 없어도 파싱된다', () => {
  const { dataAsOf: _omitted, ...withoutDataAsOf } = rankingPage(2026);
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
  const { viewerClass: _omitted, ...withoutViewerClass } = rankingPage(2026);
  expect(() => parseRankingPage(withoutViewerClass)).toThrow(
    RankingResponseError,
  );
});

test('viewerClass 가 public|staff 가 아니면 거부한다', () => {
  expect(() =>
    parseRankingPage({ ...rankingPage(2026), viewerClass: 'STUDENT' }),
  ).toThrow(RankingResponseError);
  expect(() =>
    parseRankingPage({ ...rankingPage(2026), viewerClass: 'ADMIN' }),
  ).toThrow(RankingResponseError);
});

test('nextCycleAt 이 없어도 파싱되고 null 로 떨어진다', () => {
  const { nextCycleAt: _omitted, ...withoutNextCycleAt } = rankingPage(2026);
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
  const withName = parseRankingPage({
    ...base,
    viewerClass: 'staff',
    items: [{ ...base.items[0], name: 'synthetic-staff-name' }],
  });
  expect(withName.items[0]?.name).toBe('synthetic-staff-name');

  const withNull = parseRankingPage({
    ...base,
    viewerClass: 'staff',
    items: [{ ...base.items[0], name: null }],
  });
  expect(withNull.items[0]?.name).toBeNull();

  const omitted = parseRankingPage({
    ...base,
    viewerClass: 'staff',
  });
  expect(omitted.items[0]?.name).toBeNull();
});
