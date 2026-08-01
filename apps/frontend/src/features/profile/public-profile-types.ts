export type PublicProfileApplicationMode = 'PERSONAL' | 'TEAM';

export type PublicProfileCategory =
  | 'BASIC'
  | 'SW_VALUE_SPREAD'
  | 'OSS_CONTEST'
  | 'CAPSTONE'
  | 'SW_CONVERGENCE'
  | 'GLOBAL_MAKERTHON'
  | 'CORPORATE_INTERNSHIP';

export type PublicProfileMetrics = {
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly releaseCount: number;
};

export type PublicProfileProject = {
  readonly projectId: string;
  readonly programId: string;
  readonly programName: string;
  readonly category: PublicProfileCategory;
  readonly applicationMode: PublicProfileApplicationMode;
  readonly displayName: string;
  readonly repositoryName: string;
  readonly githubUrl: string;
  readonly publishedAt: string;
  readonly detailUrl: string;
  readonly modeLabel: '개인' | '팀';
  readonly publishedLabel: string;
  /** collection이 이 저장소를 한 번이라도 관측했는지. false면 dataAsOf/metrics가 없다(미관측). */
  readonly observed: boolean;
  readonly dataAsOf: string | null;
  /** observed가 true인데 metrics가 0값이면 "관측됐지만 이 사용자의 기여가 없음"을 뜻한다. */
  readonly metrics: PublicProfileMetrics | null;
};

export type PublicProfile = {
  readonly userId: string;
  readonly githubNickname: string;
  readonly avatarUrl: string | null;
  readonly projects: readonly PublicProfileProject[];
  /** 관측된 project들만 합산한 사용자 전체 누적. */
  readonly observedTotals: PublicProfileMetrics;
};

export type PublicProfileState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error' }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'ready'; readonly profile: PublicProfile };
