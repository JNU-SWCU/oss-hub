export interface RepositoryContributorView {
  readonly githubId: string;
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly releaseCount: number;
  readonly issueCount: number;
}

export interface TeamRepositoryContributionsView {
  readonly repositoryId: string;
  readonly repositoryUrl: string;
  readonly window: {
    readonly from: string;
    readonly to: string;
    readonly timeZone: 'Asia/Seoul';
  };
  readonly collectionStatus: 'NOT_COLLECTED' | 'COLLECTED' | 'ERROR';
  readonly lastSuccessAt: string | null;
  readonly members: readonly (RepositoryContributorView & {
    readonly userId: string;
    readonly hasObservations: boolean;
  })[];
  /**
   * 「팀원이 아닌 사람의 기여」 — 이 저장소에서 프로그램 기간 안 지금 팀원이 아닌 사람의 Commit·PR·Issue
   * 수(Commit은 ADR-009 `전체 − 팀원합`, PR·Issue는 봇 제외). 수집이 저장소마다 세어 두며, 누가 했는지는
   * 담지 않는다. 아직 세지 않았거나, 센 기준(프로그램·기간)이 지금과 다르면 `null`이다.
   */
  readonly outsiderContributions: TeamOutsiderContributionsView | null;
}

export interface TeamOutsiderContributionsView {
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly issueCount: number;
}

export interface RepositoryUrlHistoryView {
  readonly id: string;
  readonly occurredAt: string;
  readonly actorGithubLogin: string;
  readonly previousRepositoryUrl: string | null;
  readonly newRepositoryUrl: string;
}

export interface TeamRepositoryEvidenceView {
  readonly repositoryContributions: TeamRepositoryContributionsView | null;
  readonly repositoryUrlHistory: RepositoryUrlHistoryPage;
}

export interface RepositoryUrlHistoryPage {
  readonly items: readonly RepositoryUrlHistoryView[];
  readonly nextCursor: string | null;
}

export interface RepositoryUrlHistoryCursor {
  readonly occurredAt: Date;
  readonly id: string;
}

export interface TeamActivityCounts {
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly issueCount: number;
}

/**
 * 팀 저장소 활동(#1133) — 학생(자기 팀)과 교직원이 같은 조회로 같은 값을 받는다.
 * 역할이 가르는 칸은 `canEditRepositoryUrl` 하나뿐이다.
 *
 * `points`는 기여가 있는 날만 담는다 — 빈 날을 0으로 채우지 않는다(프로그램 기간이
 * 센티널이면 수천 년이 된다). 창을 화면 폭에 맞춰 자르는 것은 화면 몫이다.
 */
export interface TeamActivityView {
  readonly applicationId: string | null;
  readonly repository: { readonly id: string; readonly url: string } | null;
  readonly status: 'NOT_CONNECTED' | 'NOT_COLLECTED' | 'COLLECTED' | 'ERROR';
  readonly lastSuccessAt: string | null;
  readonly window: TeamRepositoryContributionsView['window'];
  readonly canEditRepositoryUrl: boolean;
  readonly members: readonly {
    readonly userId: string;
    readonly githubLogin: string;
    readonly totals: TeamActivityCounts;
    readonly points: readonly (TeamActivityCounts & {
      readonly date: string;
    })[];
  }[];
}
