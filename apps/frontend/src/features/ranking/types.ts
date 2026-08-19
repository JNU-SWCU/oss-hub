/** Preferred ranking filter — calendar year or all-time. */
export const RANKING_YEAR_ALL = 'all' as const;

export type RankingYear = number | typeof RANKING_YEAR_ALL;

/**
 * Legacy period values (API `?period=`). Prefer `?year=`.
 * @deprecated
 */
export const RANKING_PERIODS = {
  THIS_YEAR: 'THIS_YEAR',
  ALL: 'ALL',
} as const;

/** @deprecated Use RankingYear. */
export type RankingPeriod =
  (typeof RANKING_PERIODS)[keyof typeof RANKING_PERIODS];

/**
 * 사람 축 랭킹 항목 — 지표 이름은 **wire 이름 그대로** 쓴다.
 *
 * 내부에서만 통하는 별칭(`prCount`)을 두면 파서 한쪽만 개명됐을 때 HTTP는 200인데
 * 열 하나가 조용히 0이 된다(`activity-timeline/api.ts`의 사고 기록 참고).
 *
 * `starCount`는 **누적(lifetime)** 값이다 — GitHub이 올해분 star를 싸게 주지 않아
 * 수집기가 계정 전체 star를 센다(ADR-010). 화면은 이 사실을 반드시 문구로 밝힌다.
 */
export interface RankingItem {
  readonly rank: number;
  readonly displayName: string;
  readonly githubLogin: string;
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly issueCount: number;
  readonly repositoryCount: number;
  readonly starCount: number;
  readonly total: number;
}

export interface RankingPage {
  readonly year: RankingYear;
  readonly items: readonly RankingItem[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  /**
   * 이 수치가 언제 기준인지.
   *
   * 숫자만 있으면 오늘 값인지 석 달 전 값인지 알 수 없다 — 수집이 멈춘 것을
   * 화면이 먼저 말해야 한다. 아직 관측이 없거나 백엔드가 이 칸을 보내기 전이면 null.
   */
  readonly dataAsOf: Date | null;
}

export interface RankingYears {
  readonly years: readonly number[];
}

/**
 * Asia/Seoul 기준 현재 연도.
 *
 * 랭킹 기본은 **올해**다(ADR-010 §1). 전체 누적이 기본이면 먼저 들어온 학생이
 * 영구히 위에 남아 신입생 활동이 화면에서 보이지 않는다.
 */
export function currentRankingYear(now: Date = new Date()): number {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).getUTCFullYear();
}

/**
 * Sidebar·deep-link.
 *
 * 전체 누적은 **명시적으로** `?year=all`이다. 예전에는 `/ranking`이 전체를 뜻했는데,
 * 기본이 올해로 바뀐 뒤에도 그대로 두면 "전체" 링크가 올해를 열어 버린다.
 */
export function rankingListHref(year: RankingYear): string {
  if (year === RANKING_YEAR_ALL) return '/ranking?year=all';
  return `/ranking?year=${year}`;
}

/**
 * Parse `?year=`.
 *
 * 값이 없으면 **올해**다 — 백엔드 기본과 같은 규칙이라야 링크 없이 연 화면과
 * 서버가 같은 것을 본다. `all`은 명시했을 때만이다.
 */
export function parseRankingYearSearchParam(
  raw: string | null | undefined,
): RankingYear {
  if (raw === null || raw === undefined || raw === '')
    return currentRankingYear();
  if (raw.toLowerCase() === RANKING_YEAR_ALL) return RANKING_YEAR_ALL;
  const year = Number(raw);
  if (Number.isInteger(year) && year >= 2000 && year <= 2100) return year;
  // 알 수 없는 값은 올해로 떨어뜨린다. 기본이 바뀌었으므로 실수한 링크가
  // 조용히 전체 누적을 여는 일이 없어야 한다.
  return currentRankingYear();
}
