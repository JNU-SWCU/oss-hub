import { rankingYearInAsiaSeoul } from './ranking-event';

/** Preferred filter — calendar year or all-time. */
export const RANKING_YEAR_ALL = 'all' as const;

/** Inclusive calendar-year bounds for `?year=` (single source for DTO + parse). */
export const RANKING_YEAR_MIN = 2000;
export const RANKING_YEAR_MAX = 2100;

export type RankingYear = number | typeof RANKING_YEAR_ALL;

/**
 * Legacy query values (`?period=`). Prefer `?year=` — mapped in
 * `resolveRankingYearFromQuery`.
 */
export const LEGACY_RANKING_PERIODS = {
  THIS_YEAR: 'THIS_YEAR',
  ALL: 'ALL',
} as const;

export type LegacyRankingPeriod =
  (typeof LEGACY_RANKING_PERIODS)[keyof typeof LEGACY_RANKING_PERIODS];

/** @deprecated Use `RANKING_YEAR_ALL` / numeric years. Kept for call-site migration. */
export const RANKING_PERIODS = LEGACY_RANKING_PERIODS;

/** @deprecated Use `RankingYear`. */
export type RankingPeriod = LegacyRankingPeriod;

/**
 * 공개 랭킹 지표 5종(관리자 요청 — release 대신 star·repo·issue).
 * `starCount`는 그 계정 공개 저장소의 **누적** star다 — GitHub이 연도별
 * 분해를 주지 않는다. release는 저장소 축(② 프로그램 표면) 전속이다.
 */
export interface RankingMetrics {
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly issueCount: number;
  readonly repositoryCount: number;
  readonly starCount: number;
}

export interface RankingEntry extends RankingMetrics {
  readonly rank: number;
  /**
   * 현행 계약상 항상 `githubLogin`과 같다(D3). 프론트가 이미 이 키를 렌더하므로
   * 내려주되, 실명을 여기 넣지 않는다.
   */
  readonly displayName: string;
  readonly githubLogin: string;
  /** 학과. `UserProfile` 우선, 없으면 legacy `User.department`. 미입력이면 null. */
  readonly department: string | null;
  readonly total: number;
}

export interface RankingPage {
  readonly year: RankingYear;
  readonly items: readonly RankingEntry[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  /**
   * 이 수치가 언제 기준인지 (ADR-010 §10).
   *
   * 이번 사고의 본질은 "멈췄는데 아무도 몰랐다"였다. 화면에 숫자만 있으면
   * 오늘 값인지 석 달 전 값인지 구분할 방법이 없다 — 그래서 갱신 시각을
   * 봉투에 실어 화면이 먼저 말하게 한다.
   *
   * 관측된 기여가 하나도 없으면 `null` 이다.
   */
  readonly dataAsOf: Date | null;
}

/**
 * Resolve ranking scope from preferred `year` or legacy `period`.
 * Default when neither is set: all-time (`all`).
 */
export function resolveRankingYearFromQuery(
  year: RankingYear | undefined,
  period: LegacyRankingPeriod | undefined,
  now: Date = new Date(),
): RankingYear {
  if (year !== undefined) return year;
  if (period === LEGACY_RANKING_PERIODS.THIS_YEAR) {
    return rankingYearInAsiaSeoul(now);
  }
  if (period === LEGACY_RANKING_PERIODS.ALL) return RANKING_YEAR_ALL;
  // 아무 것도 지정하지 않으면 **올해**다(ADR-010 §1).
  //
  // 예전 기본값은 전체 누적이었다. 그러면 먼저 들어온 학생이 영구히 위에 남아
  // 신입생이 아무리 활동해도 화면에서 보이지 않는다 — 랭킹이 재학 기간 순서를
  // 보여주는 셈이다. 학생이 묻는 것은 "올해 내가 얼마나 했나"이므로
  // 기본을 올해로 두고 과거 연도는 선택으로 남긴다.
  return rankingYearInAsiaSeoul(now);
}
