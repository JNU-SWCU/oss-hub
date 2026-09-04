import type { ProgramCategory, ProgramTrackType } from './program-templates';
import type { PublishBlockedReason } from '@/lib/repository-publication';

export type ViewerRole = 'STUDENT' | 'STAFF' | 'ADMIN' | 'PENDING' | null;
export type ApplicationStatus = 'SUBMITTED' | 'APPROVED' | 'REJECTED';
/** 교직원이 신청에 할 수 있는 판정. 목록·상세 두 화면이 같은 집합을 쓴다. */
export type ApplicationDecisionAction = 'APPROVE' | 'REJECT' | 'REVERT';
export type SubmissionStatus =
  'NOT_SUBMITTED' | 'SUBMITTED' | 'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED';
export type SubmissionType = 'FILE' | 'TEXT';

export const PROGRAM_PARTICIPATION_TYPES = ['individual', 'team'] as const;
export type ProgramParticipation = (typeof PROGRAM_PARTICIPATION_TYPES)[number];

export const APPLICATION_FIELD_TYPES = ['auto', 'text', 'textarea'] as const;
export type ApplicationFormFieldType = (typeof APPLICATION_FIELD_TYPES)[number];

export const APPLICATION_FIELD_KEYS = [
  'applicantName',
  'title',
  'summary',
] as const;
export type ApplicationFormFieldKey = (typeof APPLICATION_FIELD_KEYS)[number];

export interface ApplicationFormField {
  readonly key: ApplicationFormFieldKey;
  readonly type: ApplicationFormFieldType;
  readonly label: string;
  readonly required: boolean;
}

export interface ApplicationFormTemplate {
  readonly key: string;
  readonly version: number;
  readonly name: string;
  readonly participation: ProgramParticipation;
  readonly fields: readonly ApplicationFormField[];
}

/** 카드 하단 안내 문구 — 학생: 본인 지원 상태 / 교직원: 지원·승인대기 집계. */
export interface ProgramListItemNote {
  readonly text: string;
  readonly icon?: 'team';
}

export interface ProgramListItem {
  readonly id: string;
  readonly name: string;
  readonly organizer: string;
  readonly trackType: ProgramTrackType | null;
  /** 게시 축. 모집 기간 파생 상태가 아니다. 없으면 PUBLISHED 로 본다. */
  readonly lifecycle?: 'PUBLISHED' | 'ARCHIVED';
  readonly applicationStartAt: string;
  readonly applicationEndAt: string;
  /** null이면 종료일을 아직 안 닫은 것 — 접수 종료 후 진행중으로 본다. */
  readonly endAt: string | null;
  readonly description: string;
  /** 카드 하단 안내 문구. 없으면 표시 안 함. */
  readonly note?: ProgramListItemNote;
  /** 뷰어 본인의 신청 상태. 신청한 적 없으면 undefined. */
  readonly viewerApplicationStatus?: ApplicationStatus;
  /** 교직원용 — 전체 지원 건수 집계. */
  readonly applicationCount?: number;
  /** 교직원용 — 승인 대기 건수 집계. */
  readonly pendingApplicationCount?: number;
}

/** 공개 카탈로그 필터 — 연습대회 없음. backend 목록 status와 한 벌. */
export const PROGRAM_LIST_STATUSES = [
  'all',
  'recruiting',
  'in_progress',
  'upcoming',
  'ended',
] as const;
export type ProgramListStatus = (typeof PROGRAM_LIST_STATUSES)[number];

export const PROGRAM_LIST_STATUS_LABELS = {
  all: '전체',
  recruiting: '모집중',
  in_progress: '진행중',
  upcoming: '예정',
  ended: '종료',
} as const satisfies Readonly<Record<ProgramListStatus, string>>;

/** 카테고리 라벨 SSOT. program-detail-format.ts 서술형 문구를 canonical로 채택. */
export const PROGRAM_CATEGORY_LABELS = {
  BASIC: '기본 프로그램',
  SW_VALUE_SPREAD: 'SW 가치확산',
  OSS_CONTEST: 'OSS 경진대회',
  CAPSTONE: '캡스톤',
  SW_CONVERGENCE: 'SW 융합',
  GLOBAL_MAKERTHON: '글로벌 메이커톤',
  CORPORATE_INTERNSHIP: '기업 인턴십',
} as const satisfies Record<ProgramCategory, string>;

/** 사이드 패널·칩 공용. `all`은 쿼리 없이 `/programs`. */
export function programListHref(status: ProgramListStatus): string {
  if (status === 'all') return '/programs';
  return `/programs?status=${status}`;
}

/** 정렬 기준 — backend `ProgramListQuerySort`와 한 벌. 생략하면 레거시 순서(모집중 우선). */
export const PROGRAM_LIST_SORTS = [
  'name',
  'applicationPeriod',
  'status',
] as const;
export type ProgramListSort = (typeof PROGRAM_LIST_SORTS)[number];

export const PROGRAM_LIST_SORT_LABELS = {
  name: '프로그램 이름',
  applicationPeriod: '지원 기간',
  status: '상태',
} as const satisfies Readonly<Record<ProgramListSort, string>>;

export const PROGRAM_LIST_DIRECTIONS = ['asc', 'desc'] as const;
export type ProgramListDirection = (typeof PROGRAM_LIST_DIRECTIONS)[number];

export interface ProgramListParams {
  readonly page: number;
  readonly pageSize: number;
  readonly search: string;
  readonly status: ProgramListStatus;
  /** 생략하면 backend 레거시 기본 정렬을 그대로 쓴다. */
  readonly sort?: ProgramListSort;
  readonly direction?: ProgramListDirection;
}

export interface ProgramListPage {
  readonly items: readonly ProgramListItem[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;
}

/** GET /programs/status-counts — 사이드바 뱃지. 5키 항상 존재. */
export type ProgramStatusCounts = Readonly<Record<ProgramListStatus, number>>;

export const APPLICATION_LIST_STATUSES = [
  'all',
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
] as const;
export type ApplicationListStatus = (typeof APPLICATION_LIST_STATUSES)[number];

export interface ApplicationListParams {
  readonly page: number;
  readonly pageSize: number;
  readonly search: string;
  readonly status: ApplicationListStatus;
}

export const REPOSITORY_PROVISIONING_JOB_STATUSES = [
  'NOT_REQUESTED',
  'DISABLED',
  'PENDING',
  'PROCESSING',
  'SUCCEEDED',
  'RETRYABLE_FAILED',
  'FAILED',
  'ANOMALOUS',
] as const;
export type RepositoryProvisioningJobStatus =
  (typeof REPOSITORY_PROVISIONING_JOB_STATUSES)[number];
export type RepositoryProvisioningSafeErrorClass =
  'AUTH' | 'RATE_LIMIT' | 'UPSTREAM_REJECTED' | 'UNKNOWN';

export interface RepositoryProvisioning {
  readonly enabled: boolean;
  readonly jobStatus: RepositoryProvisioningJobStatus;
  readonly updatedAt: string;
  readonly safeErrorClass: RepositoryProvisioningSafeErrorClass | null;
}

/** 승인이 저장소를 새로 만드는가(`NEW`), 신청자가 낸 저장소를 잇는가(`OWN`). */
export type RepositoryConnectionMode = 'NEW' | 'OWN';

export interface ApplicationListItem {
  readonly id: string;
  /**
   * 어느 프로그램의 신청인가. 상세 화면이 주소의 프로그램과 대조하는 데 쓴다 —
   * 백엔드 조회가 신청 id 하나로 도달하므로, 주소를 손으로 고치면 프로그램 A의
   * 화면에서 프로그램 B의 신청을 판정하게 된다.
   */
  readonly programId: string;
  readonly repositoryConnectionMode: RepositoryConnectionMode;
  /** `OWN`일 때 이을 저장소 주소. `NEW`면 null. */
  readonly repositoryUrl: string | null;
  readonly status: ApplicationStatus;
  readonly rejectionReason: string | null;
  readonly repositoryProvisioning: RepositoryProvisioning;
  readonly isRepositoryPublicationPlanned: boolean;
  readonly submittedAt: string;
  readonly participation: 'INDIVIDUAL' | 'TEAM';
  readonly applicant: {
    readonly id: string;
    readonly name: string | null;
    readonly nickname: string;
  };
  readonly team: {
    readonly id: string;
    readonly name: string;
    readonly memberCount: number;
  } | null;
  /**
   * 신청 산출물 저장소. `Application.repository` 1:1이 출처다 — 팀으로 찾지 않는다
   * (`schema.prisma`의 Repository 주석: "저장소 식별 단위는 application이다").
   * 아직 만들어지지 않았으면 `null`.
   */
  readonly repository: {
    readonly url: string;
    readonly visibility: 'PUBLIC' | 'PRIVATE';
  } | null;
  readonly answers: {
    readonly applicantName: string;
    readonly title: string;
    readonly summary: string;
  };
}

/** 교직원 팀 목록의 팀원 한 명. `name`은 가입 시 입력한 실명(없으면 `null`). */
export interface StaffProgramTeamMember {
  readonly userId: string;
  readonly name: string | null;
  readonly nickname: string;
  readonly isLeader: boolean;
}

/**
 * `GET /programs/:programId/teams` (교직원 전용) 응답 항목.
 * 학생이 쓰는 공개 로스터(`overview/teams`)와 달리 실명을 포함한다 —
 * 그쪽은 프로그램 참가자 전원에게 보이는 목록이라 nickname만 준다.
 */
export interface StaffProgramTeam {
  readonly teamId: string;
  readonly name: string;
  readonly memberCount: number;
  readonly members: readonly StaffProgramTeamMember[];
}

/**
 * `GET /programs/:programId/teams/:teamId`(교직원 전용, #874) 응답 — 팀 상세.
 * 목록(`StaffProgramTeam`)에 신청 상태·저장소 발급 상태를 더해 한 요청으로 담는다
 * — 이 화면(팀 상세)이 신청 목록을 따로 부르지 않게 하려는 것이다. 신청을 아직
 * 내지 않은 팀은 `application: null`.
 *
 * `repository`(url·visibility)는 팀 목록 응답에는 없지만 이 상세에는 **있다** —
 * 교직원이 이미 신청 목록/상세에서 보는 값이고, 팀 상세가 저장소 상태까지 한
 * 요청으로 끝내야 하기 때문이다(백엔드 `team-detail-response.dto.ts` 주석 참고).
 */
export interface StaffTeamDetailApplication {
  readonly id: string;
  readonly status: ApplicationStatus;
  readonly repositoryConnectionMode: RepositoryConnectionMode;
  readonly repository: {
    readonly id: string;
    readonly url: string;
    readonly visibility: 'PUBLIC' | 'PRIVATE';
    readonly publishEligible: boolean;
    readonly blockedReasons: readonly PublishBlockedReason[];
  } | null;
  readonly repositoryProvisioning: RepositoryProvisioning;
}

export interface StaffTeamDetail {
  readonly teamId: string;
  readonly name: string;
  readonly memberCount: number;
  readonly members: readonly StaffProgramTeamMember[];
  readonly application: StaffTeamDetailApplication | null;
}

export interface ApplicationListPage {
  readonly items: readonly ApplicationListItem[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;
}

/** #117 운영 대시보드 — Application 단위 집계. */
export interface StaffDashboardApplicationCounts {
  readonly total: number;
  readonly submitted: number;
  readonly pendingApproval: number;
  readonly approved: number;
  readonly rejected: number;
}

export interface StaffDashboardActivitySummary {
  readonly repositories: number;
  readonly commits: number;
  readonly pullRequests: number;
  readonly releases: number;
  readonly lastActivityAt: string | null;
  readonly dataAsOf: string | null;
}

export interface StaffDashboardSubmissionSummary {
  readonly approvedApplications: number;
  readonly milestones: number;
  readonly total: number;
  readonly notSubmitted: number;
  readonly submitted: number;
  readonly approved: number;
  readonly changesRequested: number;
  readonly rejected: number;
}

export interface StaffDashboardProgramSummary {
  readonly id: string;
  readonly name: string;
  readonly trackType: ProgramTrackType | null;
  readonly applicationPeriod: {
    readonly startsAt: string;
    readonly endsAt: string;
  };
  /**
   * 종료일. 「미정」은 센티널 시각으로 온다 — `program-end-at.ts` 참고.
   * 공개 목록과 같은 모집 상태 판정을 내리려면 신청기간만으로는 부족하다.
   */
  readonly endAt: string;
  /** 게시 축(PUBLISHED|ARCHIVED). 모집 기간 파생 상태가 아니다. */
  readonly lifecycle: 'PUBLISHED' | 'ARCHIVED';
  readonly applications: StaffDashboardApplicationCounts;
  readonly applicantsPath: string;
  readonly activity: StaffDashboardActivitySummary;
  readonly submissions: StaffDashboardSubmissionSummary;
}

export interface StaffDashboardSummary {
  readonly programs: readonly StaffDashboardProgramSummary[];
}

export interface SubmissionSummary {
  readonly notSubmitted: number;
  readonly submitted: number;
  readonly approved: number;
  readonly changesRequested: number;
  readonly rejected: number;
  readonly total: number;
}

export interface ProgramMilestone {
  readonly id: string;
  readonly name: string;
  readonly dueAt: string;
  readonly dDay: number;
  readonly deadlineLabel: string;
  readonly description: string | null;
  readonly submissionType: SubmissionType | null;
  readonly submissionItemCount: number;
  readonly viewerSubmissionStatus: SubmissionStatus | null;
  readonly applicationSubmissionSummary: SubmissionSummary | null;
}

export interface ProgramDetail {
  readonly id: string;
  readonly name: string;
  readonly organizer: string;
  readonly trackType: ProgramTrackType | null;
  readonly applicationTemplateKey: string;
  /**
   * 게시 축(PUBLISHED|ARCHIVED). 모집 기간 파생 상태가 아니다 — 상세 화면은 이 값이
   * 있어야 신청 기간만 보고 「모집중」을 그리는 일을 멈춘다(#1092).
   *
   * 선택 필드로 두지 않는다. 없을 때 PUBLISHED 로 보는 조용한 fallback 을 두면 내린
   * 프로그램이 다시 「모집중 + 신청하기」로 보이는 이 티켓의 결함이 소리 없이 돌아온다.
   * 서버가 반드시 싣는 값이므로(program-detail.dto.ts) 없으면 응답이 계약을 어긴 것이다.
   */
  readonly lifecycle: 'PUBLISHED' | 'ARCHIVED';
  readonly description: string;
  readonly repositoryProvisioningEnabled: boolean;
  readonly applicationPeriod: {
    readonly startsAt: string;
    readonly endsAt: string;
  };
  /**
   * 프로그램 운영 기간. `endsAt` 은 목록 항목의 `endAt` 과 같은 축이라 종료 판정에
   * 그대로 쓴다. 없으면(이 축을 싣지 않던 응답) 종료일을 모르는 것이므로 목록이
   * `endAt: null` 을 다루는 방식과 같게 「아직 안 끝남」으로 본다.
   */
  readonly operatingPeriod?: {
    readonly startsAt: string;
    readonly endsAt: string;
  };
  readonly viewer: {
    readonly role: ViewerRole;
    readonly applicationStatus: ApplicationStatus | null;
  };
  readonly milestones: readonly ProgramMilestone[];
}

export interface ProgramActivity {
  readonly applicationId: string;
  readonly label: string;
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly releaseCount: number;
  readonly dataAsOf: string | null;
  readonly lastActivityAt: string | null;
}
