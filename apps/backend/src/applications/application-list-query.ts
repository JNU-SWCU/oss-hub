const APPLICATION_LIST_STATUSES = [
  'all',
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
] as const;

type ApplicationListStatus = (typeof APPLICATION_LIST_STATUSES)[number];

/**
 * 같은 목록 endpoint가 돌려줄 projection을 고르는 명시적 파라미터.
 *
 * `default`는 기존 응답 모양 그대로다 — 이 값이 기본이어야 아직 배포되지 않은
 * 프런트가 그대로 동작한다. `team-management`는 팀 관리 화면이 쓰는 lean projection으로,
 * 저장소 관련 필드를 아예 담지 않고 팀 구성원 표시 이름을 대신 싣는다.
 */
const APPLICATION_LIST_VIEWS = ['default', 'team-management'] as const;

type ApplicationListView = (typeof APPLICATION_LIST_VIEWS)[number];

interface ApplicationListQuery {
  readonly page: number;
  readonly pageSize: number;
  readonly search: string;
  readonly status: ApplicationListStatus;
  readonly view: ApplicationListView;
}

export {
  APPLICATION_LIST_STATUSES,
  APPLICATION_LIST_VIEWS,
  type ApplicationListQuery,
  type ApplicationListStatus,
  type ApplicationListView,
};
