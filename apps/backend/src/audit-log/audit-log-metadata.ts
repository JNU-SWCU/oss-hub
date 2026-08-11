import {
  AccountStatus,
  ApplicationStatus,
  ProgramLifecycle,
  RepositoryVisibility,
  Role,
  RoleRequestStatus,
} from '@prisma/client';

export const ACCESS_AUDIT_SCHEMA_VERSION_V1 = 1 as const;
export const ACCESS_AUDIT_SCHEMA_VERSION = 2 as const;

export const ACCESS_AUDIT_EVENT_KINDS = {
  ROLE_REQUEST_APPROVED: 'ROLE_REQUEST_APPROVED',
  ROLE_REQUEST_REJECTED: 'ROLE_REQUEST_REJECTED',
  ROLE_REQUEST_REVOKED: 'ROLE_REQUEST_REVOKED',
  ROLE_REQUEST_RESTORED: 'ROLE_REQUEST_RESTORED',
  DIRECT_ROLE_CHANGED: 'DIRECT_ROLE_CHANGED',
  ACCOUNT_STATUS_CHANGED: 'ACCOUNT_STATUS_CHANGED',
} as const;

export const ACCESS_AUDIT_ACTIONS = {
  ROLE_REQUEST_APPROVED: 'STAFF_ROLE_REQUEST_APPROVED',
  ROLE_REQUEST_REJECTED: 'STAFF_ROLE_REQUEST_REJECTED',
  ROLE_REQUEST_REVOKED: 'STAFF_ROLE_REQUEST_REVOKED',
  ROLE_REQUEST_RESTORED: 'STAFF_ROLE_REQUEST_RESTORED',
  DIRECT_ROLE_CHANGED: 'USER_ROLE_CHANGED',
  ACCOUNT_STATUS_CHANGED: 'USER_ACCOUNT_STATUS_CHANGED',
} as const;

export type AccessAuditEventKind =
  (typeof ACCESS_AUDIT_EVENT_KINDS)[keyof typeof ACCESS_AUDIT_EVENT_KINDS];

export type AccessAuditAction =
  (typeof ACCESS_AUDIT_ACTIONS)[keyof typeof ACCESS_AUDIT_ACTIONS];

// 이벤트 시점에 관측한 사람(행위자 또는 대상)의 표시 이름·GitHub 로그인 스냅샷이다.
// 조회 시점에 User를 다시 조회해 재계산하지 않는다(개명·탈퇴 이후에도 원본 로그를 보존).
export type AuditPersonSnapshot = {
  readonly displayName: string | null;
  readonly githubLogin: string;
};

export type AuditActorSnapshot = AuditPersonSnapshot;
export type AuditTargetSnapshot = AuditPersonSnapshot;

export type AccessAuditState = {
  readonly role: Role | null;
  readonly accountStatus: AccountStatus;
  readonly requestStatus: RoleRequestStatus | null;
};

type AccessAuditMetadataBaseV1 = {
  readonly schemaVersion: typeof ACCESS_AUDIT_SCHEMA_VERSION_V1;
  readonly actor: AuditActorSnapshot;
  readonly before: AccessAuditState;
  readonly after: AccessAuditState;
};

type AccessAuditMetadataBaseV2 = {
  readonly schemaVersion: typeof ACCESS_AUDIT_SCHEMA_VERSION;
  readonly actor: AuditActorSnapshot;
  readonly target: AuditTargetSnapshot;
  readonly before: AccessAuditState;
  readonly after: AccessAuditState;
};

type AccessAuditEventUnion<Base> =
  | (Base & {
      readonly eventKind: typeof ACCESS_AUDIT_EVENT_KINDS.ROLE_REQUEST_APPROVED;
    })
  | (Base & {
      readonly eventKind: typeof ACCESS_AUDIT_EVENT_KINDS.ROLE_REQUEST_REJECTED;
      readonly rejectionReason: string;
    })
  | (Base & {
      readonly eventKind: typeof ACCESS_AUDIT_EVENT_KINDS.ROLE_REQUEST_REVOKED;
    })
  | (Base & {
      readonly eventKind: typeof ACCESS_AUDIT_EVENT_KINDS.ROLE_REQUEST_RESTORED;
    })
  | (Base & {
      readonly eventKind: typeof ACCESS_AUDIT_EVENT_KINDS.DIRECT_ROLE_CHANGED;
    })
  | (Base & {
      readonly eventKind: typeof ACCESS_AUDIT_EVENT_KINDS.ACCOUNT_STATUS_CHANGED;
    });

// schemaVersion 1: 액터 스냅샷만 있고 대상은 targetType/targetId로만 식별된 과거 행이다.
// 절대 다시 쓰지 않는다 — append-only 원장이므로 이 버전은 읽기 호환 목적으로만 남는다.
export type AccessAuditMetadataV1 =
  AccessAuditEventUnion<AccessAuditMetadataBaseV1>;

// schemaVersion 2: 액터·대상 모두 이벤트 시점 스냅샷을 기록한다(PR02 target 보강분).
export type AccessAuditMetadataV2 =
  AccessAuditEventUnion<AccessAuditMetadataBaseV2>;

export type AccessAuditMetadata = AccessAuditMetadataV1 | AccessAuditMetadataV2;

type DistributiveOmit<T, Key extends PropertyKey> = T extends T
  ? Omit<T, Key>
  : never;

// 새 행은 항상 최신 스키마 버전으로 쓴다.
export type AccessAuditMetadataInput = DistributiveOmit<
  AccessAuditMetadataV2,
  'schemaVersion'
>;

/**
 * todo 20 — repository 수동 공개 typed audit의 최소 정의. 전체 action registry(#action
 * 카탈로그·문서화 등)는 todo 21 소관이라 여기서는 이 한 번의 write에 필요한 타입만 둔다.
 * 실명·studentId·email 등 금지 필드는 담지 않는다 — actor는 `AuditLog.actorId` FK로 이미
 * 식별되므로 metadata에 다시 스냅샷하지 않는다.
 */
export const REPOSITORY_PUBLISH_AUDIT_SCHEMA_VERSION_V1 = 1 as const;
// schemaVersion 2 — PROGRAM_LIFECYCLE의 programName 보강분과 같은 규약: 이벤트 시점
// 저장소 전체 이름(owner/name) 스냅샷을 추가한다. `repositories.service.ts`가 이미
// 로드해 둔 `name`+`url`에서 파생하므로 추가 쿼리는 없다. 조회 시점에 Repository를 다시
// 조회해 재계산하지 않는다(rename·삭제 이후에도 원본 로그를 보존).
export const REPOSITORY_PUBLISH_AUDIT_SCHEMA_VERSION = 2 as const;

export const REPOSITORY_PUBLISH_AUDIT_ACTIONS = {
  REPOSITORY_PUBLISHED: 'REPOSITORY_PUBLISHED',
} as const;

export type RepositoryPublishAuditAction =
  (typeof REPOSITORY_PUBLISH_AUDIT_ACTIONS)[keyof typeof REPOSITORY_PUBLISH_AUDIT_ACTIONS];

export type RepositoryPublishAuditVisibilityState = {
  readonly visibility: RepositoryVisibility;
};

type RepositoryPublishAuditMetadataBaseV1 = {
  readonly schemaVersion: typeof REPOSITORY_PUBLISH_AUDIT_SCHEMA_VERSION_V1;
  readonly repositoryId: string;
  readonly before: RepositoryPublishAuditVisibilityState;
  readonly after: RepositoryPublishAuditVisibilityState & {
    readonly publishedAt: string;
  };
};

type RepositoryPublishAuditMetadataBaseV2 = {
  readonly schemaVersion: typeof REPOSITORY_PUBLISH_AUDIT_SCHEMA_VERSION;
  readonly repositoryId: string;
  // `owner/name` 형태의 저장소 전체 이름. NEW 연결 모드는 url이 항상
  // `https://github.com/{owner}/{name}` 꼴이라 파싱되고, OWN 모드처럼 형태가 다른 외부
  // url은 파싱에 실패할 수 있어 그때는 name만 남긴다(derivePublicRepositoryFullName).
  readonly repositoryFullName: string;
  readonly before: RepositoryPublishAuditVisibilityState;
  readonly after: RepositoryPublishAuditVisibilityState & {
    readonly publishedAt: string;
  };
};

// schemaVersion 1: 이름 스냅샷이 없는 과거 행이다. 절대 다시 쓰지 않는다 —
// append-only 원장이므로 이 버전은 읽기 호환 목적으로만 남는다.
export type RepositoryPublishAuditMetadataV1 =
  RepositoryPublishAuditMetadataBaseV1;
// schemaVersion 2: 저장소 전체 이름 스냅샷을 함께 기록한다.
export type RepositoryPublishAuditMetadataV2 =
  RepositoryPublishAuditMetadataBaseV2;

export type RepositoryPublishAuditMetadata =
  RepositoryPublishAuditMetadataV1 | RepositoryPublishAuditMetadataV2;

export type RepositoryPublishAuditMetadataInput = DistributiveOmit<
  RepositoryPublishAuditMetadataV2,
  'schemaVersion'
>;

// 새 행은 항상 최신 스키마 버전으로 쓴다.
export function createRepositoryPublishAuditMetadata(
  input: RepositoryPublishAuditMetadataInput,
): RepositoryPublishAuditMetadataV2 {
  return { schemaVersion: REPOSITORY_PUBLISH_AUDIT_SCHEMA_VERSION, ...input };
}

// NEW 연결 모드는 url이 `https://github.com/{owner}/{name}` 꼴로 저장되므로 owner를
// 그대로 뽑아낼 수 있다. OWN 모드는 임의의 외부 url일 수 있어(형태가 강제되지 않는다)
// 매칭에 실패하면 owner 없이 저장소 이름만 남긴다 — 그래도 cuid보다는 의미가 있다.
const GITHUB_REPOSITORY_URL_PATTERN =
  /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)\/?$/;

export function deriveRepositoryFullName(name: string, url: string): string {
  const match = GITHUB_REPOSITORY_URL_PATTERN.exec(url);
  return match ? `${match[1]}/${match[2]}` : name;
}

export const PROGRAM_LIFECYCLE_AUDIT_SCHEMA_VERSION_V1 = 1 as const;
export const PROGRAM_LIFECYCLE_AUDIT_SCHEMA_VERSION = 2 as const;

export const PROGRAM_LIFECYCLE_AUDIT_ACTIONS = {
  PROGRAM_ARCHIVED: 'PROGRAM_ARCHIVED',
  PROGRAM_RESTORED: 'PROGRAM_RESTORED',
} as const;

type ProgramLifecycleAuditMetadataBaseV1 = {
  readonly schemaVersion: typeof PROGRAM_LIFECYCLE_AUDIT_SCHEMA_VERSION_V1;
  readonly before: { readonly lifecycle: ProgramLifecycle };
  readonly after: { readonly lifecycle: ProgramLifecycle };
};

type ProgramLifecycleAuditMetadataBaseV2 = {
  readonly schemaVersion: typeof PROGRAM_LIFECYCLE_AUDIT_SCHEMA_VERSION;
  // 이벤트 시점 프로그램 이름 스냅샷(ACCESS_AUDIT target 보강분과 같은 규약) —
  // 감사 로그 화면이 cuid 대신 이름을 보이려면 이 값이 필요하다. 조회 시점에
  // Program을 다시 조회해 재계산하지 않는다(개명 이후에도 원본 로그를 보존).
  readonly programName: string;
  readonly before: { readonly lifecycle: ProgramLifecycle };
  readonly after: { readonly lifecycle: ProgramLifecycle };
};

// schemaVersion 1: 이름 스냅샷이 없는 과거 행이다. 절대 다시 쓰지 않는다 —
// append-only 원장이므로 이 버전은 읽기 호환 목적으로만 남는다.
export type ProgramLifecycleAuditMetadataV1 =
  ProgramLifecycleAuditMetadataBaseV1;
// schemaVersion 2: 이름 스냅샷을 함께 기록한다.
export type ProgramLifecycleAuditMetadataV2 =
  ProgramLifecycleAuditMetadataBaseV2;

export type ProgramLifecycleAuditMetadata =
  ProgramLifecycleAuditMetadataV1 | ProgramLifecycleAuditMetadataV2;

export type ProgramLifecycleAuditMetadataInput = Omit<
  ProgramLifecycleAuditMetadataV2,
  'schemaVersion'
>;

// 새 행은 항상 최신 스키마 버전으로 쓴다.
export function createProgramLifecycleAuditMetadata(
  input: ProgramLifecycleAuditMetadataInput,
): ProgramLifecycleAuditMetadataV2 {
  return { schemaVersion: PROGRAM_LIFECYCLE_AUDIT_SCHEMA_VERSION, ...input };
}

/**
 * #875 — ADMIN 프로그램 삭제. `Program` 행 자체가 삭제되므로(PROGRAM_LIFECYCLE의 join
 * fallback과 달리) 조회 시점에 다시 조회할 대상이 없다 — programName을 **반드시** 작성
 * 시점에 스냅샷한다. `lifecycle`은 삭제 당시 상태(PUBLISHED/ARCHIVED), `blockingCounts`는
 * 차단 정책을 통과했다는 근거(전부 0)를 남긴다. 사람 신원(실명·GitHub 로그인·학번)은
 * 담지 않는다 — 대상은 targetId(programId)로만 식별한다.
 */
export const PROGRAM_DELETION_AUDIT_SCHEMA_VERSION = 1 as const;

export const PROGRAM_DELETION_AUDIT_ACTIONS = {
  PROGRAM_DELETED: 'PROGRAM_DELETED',
} as const;

export type ProgramDeletionAuditBlockingCounts = {
  readonly applications: number;
  readonly teams: number;
  readonly submissions: number;
  readonly boardPosts: number;
};

export type ProgramDeletionAuditMetadata = {
  readonly schemaVersion: typeof PROGRAM_DELETION_AUDIT_SCHEMA_VERSION;
  readonly programName: string;
  readonly lifecycle: ProgramLifecycle;
  readonly blockingCounts: ProgramDeletionAuditBlockingCounts;
};

export function createProgramDeletionAuditMetadata(
  input: Omit<ProgramDeletionAuditMetadata, 'schemaVersion'>,
): ProgramDeletionAuditMetadata {
  return { schemaVersion: PROGRAM_DELETION_AUDIT_SCHEMA_VERSION, ...input };
}

/**
 * #547 — ADMIN 수집 트리거. actor는 `AuditLog.actorId` FK로 이미 식별되므로 metadata에
 * 다시 스냅샷하지 않는다. `runId`는 트리거가 202로 돌려준 값과 같은 값이라(#546) 이
 * 기록만으로 실행 이력 조회까지 이어진다. 자격증명·저장소 이름은 담지 않는다.
 */
export const COLLECTION_TRIGGER_AUDIT_SCHEMA_VERSION = 1 as const;

export const COLLECTION_TRIGGER_AUDIT_ACTIONS = {
  COLLECTION_SYNC_TRIGGERED: 'COLLECTION_SYNC_TRIGGERED',
} as const;

export type CollectionTriggerAuditMetadata = {
  readonly schemaVersion: typeof COLLECTION_TRIGGER_AUDIT_SCHEMA_VERSION;
  readonly runId: string;
};

export function createCollectionTriggerAuditMetadata(
  input: Omit<CollectionTriggerAuditMetadata, 'schemaVersion'>,
): CollectionTriggerAuditMetadata {
  return { schemaVersion: COLLECTION_TRIGGER_AUDIT_SCHEMA_VERSION, ...input };
}

/**
 * #547 — 제출 파일 정리 재시도 reset(ADMIN CLI). 대상 파일은 불투명 id 하나로만 식별하며
 * 파일명·저장 경로·업로더는 담지 않는다.
 */
export const SUBMISSION_FILE_CLEANUP_AUDIT_SCHEMA_VERSION = 1 as const;

export const SUBMISSION_FILE_CLEANUP_AUDIT_ACTIONS = {
  SUBMISSION_FILE_CLEANUP_RETRY_RESET: 'SUBMISSION_FILE_CLEANUP_RETRY_RESET',
} as const;

export type SubmissionFileCleanupAuditMetadata = {
  readonly schemaVersion: typeof SUBMISSION_FILE_CLEANUP_AUDIT_SCHEMA_VERSION;
  readonly fileId: string;
};

export function createSubmissionFileCleanupAuditMetadata(
  input: Omit<SubmissionFileCleanupAuditMetadata, 'schemaVersion'>,
): SubmissionFileCleanupAuditMetadata {
  return {
    schemaVersion: SUBMISSION_FILE_CLEANUP_AUDIT_SCHEMA_VERSION,
    ...input,
  };
}

/**
 * #547 — STAFF 신청 승인·거절. 상태 전이만 담고 **반려 사유 원문은 담지 않는다**.
 * 감사 기록의 목적은 "누가 언제 무엇을 했는가"이지 "무슨 내용을 적었는가"가 아니며,
 * 사유 원문은 이미 도메인 테이블(`Application.rejectionReason`)에 있으므로 사본을 둘
 * 이유가 없다. 신청자 실명·studentId도 담지 않는다 — 대상은 `targetId`(신청 id)로만
 * 식별한다.
 *
 * ⚠ `AuditLog`는 append-only 트리거(`20260731130000_enforce_audit_log_append_only`)로
 * UPDATE·DELETE가 막혀 있다. 한 번 쓴 개인정보는 지울 수 없다. 게다가 `GET /audit-logs`는
 * metadata JSON을 필드 선별 없이 그대로 응답에 싣는다(조회 계층 화이트리스트 부재 = #621).
 * 그래서 "쓸 때 담지 않는 것"이 유일하게 안전한 해법이다.
 *
 * 사유 "제공 여부" boolean조차 두지 않는다 — REJECT는 DTO에서 비어 있지 않은 사유를
 * 강제하므로(`patch-application-decision-request.dto.ts`) `action`/`after.status`에서 이미
 * 결정되는 값이라 정보량이 0이다.
 */
export const APPLICATION_DECISION_AUDIT_SCHEMA_VERSION_V1 = 1 as const;
// schemaVersion 2 — PROGRAM_LIFECYCLE의 programName 보강분과 같은 규약: 이벤트 시점
// 프로그램 이름 + 신청자 GitHub 로그인 스냅샷을 추가한다. `applications.service.ts`가
// 이미 로드해 둔 `application.programName`/`applicant.nickname`에서 가져오므로 추가
// 쿼리는 없다. 신청자 실명(`User.name`)은 담지 않는다 — 이 라벨의 목적은 "행 하나만
// 보고 무슨 신청인지 식별"이며 로그인만으로 충분하고, 실명은 노출 범위를 불필요하게
// 넓힌다.
export const APPLICATION_DECISION_AUDIT_SCHEMA_VERSION = 2 as const;

export const APPLICATION_DECISION_AUDIT_ACTIONS = {
  APPLICATION_APPROVED: 'APPLICATION_APPROVED',
  APPLICATION_REJECTED: 'APPLICATION_REJECTED',
  APPLICATION_REVERTED: 'APPLICATION_REVERTED',
} as const;

type ApplicationDecisionAuditMetadataBaseV1 = {
  readonly schemaVersion: typeof APPLICATION_DECISION_AUDIT_SCHEMA_VERSION_V1;
  readonly before: { readonly status: ApplicationStatus };
  readonly after: { readonly status: ApplicationStatus };
};

type ApplicationDecisionAuditMetadataBaseV2 = {
  readonly schemaVersion: typeof APPLICATION_DECISION_AUDIT_SCHEMA_VERSION;
  readonly programName: string;
  readonly applicantGithubLogin: string;
  readonly before: { readonly status: ApplicationStatus };
  readonly after: { readonly status: ApplicationStatus };
};

// schemaVersion 1: 이름 스냅샷이 없는 과거 행이다. 절대 다시 쓰지 않는다 —
// append-only 원장이므로 이 버전은 읽기 호환 목적으로만 남는다.
export type ApplicationDecisionAuditMetadataV1 =
  ApplicationDecisionAuditMetadataBaseV1;
// schemaVersion 2: 프로그램 이름 + 신청자 로그인 스냅샷을 함께 기록한다.
export type ApplicationDecisionAuditMetadataV2 =
  ApplicationDecisionAuditMetadataBaseV2;

export type ApplicationDecisionAuditMetadata =
  ApplicationDecisionAuditMetadataV1 | ApplicationDecisionAuditMetadataV2;

export type ApplicationDecisionAuditMetadataInput = Omit<
  ApplicationDecisionAuditMetadataV2,
  'schemaVersion'
>;

// 새 행은 항상 최신 스키마 버전으로 쓴다.
export function createApplicationDecisionAuditMetadata(
  input: ApplicationDecisionAuditMetadataInput,
): ApplicationDecisionAuditMetadataV2 {
  return {
    schemaVersion: APPLICATION_DECISION_AUDIT_SCHEMA_VERSION,
    ...input,
  };
}

/**
 * PR13 — 관리자가 다른 사용자의 프로필(이름·학번·학과)을 대신 고친 기록.
 *
 * 이 기능의 요지가 "PII 교정의 책임 추적"이라 다른 action들과 달리 **바뀐 값 자체를
 * 담는다**(`changes`) — 반려 사유를 일부러 빼는 `ApplicationDecisionAuditMetadata`와는
 * 정반대 결정이다. `AuditLog` 조회(`GET /audit-logs`)는 이미 `ADMIN`만 허용하므로
 * (`AuditLogService.list`), 관리자 화면에 어차피 노출되는 학번·학과를 감사 기록에서만
 * 가리는 것은 의미가 없다. 바뀌지 않은 항목은 `changes`에 아예 넣지 않는다.
 */
export const USER_PROFILE_AUDIT_SCHEMA_VERSION = 1 as const;

export const USER_PROFILE_AUDIT_ACTIONS = {
  PROFILE_UPDATED: 'USER_PROFILE_UPDATED',
} as const;

export type UserProfileAuditAction =
  (typeof USER_PROFILE_AUDIT_ACTIONS)[keyof typeof USER_PROFILE_AUDIT_ACTIONS];

export const USER_PROFILE_AUDIT_FIELDS = {
  NAME: 'name',
  STUDENT_ID: 'studentId',
  DEPARTMENT: 'department',
} as const;

export type UserProfileAuditFieldName =
  (typeof USER_PROFILE_AUDIT_FIELDS)[keyof typeof USER_PROFILE_AUDIT_FIELDS];

export type UserProfileAuditFieldChange = {
  readonly field: UserProfileAuditFieldName;
  readonly before: string | null;
  readonly after: string | null;
};

export type UserProfileAuditMetadata = {
  readonly schemaVersion: typeof USER_PROFILE_AUDIT_SCHEMA_VERSION;
  readonly actor: AuditActorSnapshot;
  readonly target: AuditTargetSnapshot;
  readonly changes: readonly UserProfileAuditFieldChange[];
};

export function createUserProfileAuditMetadata(
  input: Omit<UserProfileAuditMetadata, 'schemaVersion'>,
): UserProfileAuditMetadata {
  return { schemaVersion: USER_PROFILE_AUDIT_SCHEMA_VERSION, ...input };
}

export type AuditLogMetadata =
  | AccessAuditMetadata
  | RepositoryPublishAuditMetadata
  | ProgramLifecycleAuditMetadata
  | ProgramDeletionAuditMetadata
  | CollectionTriggerAuditMetadata
  | SubmissionFileCleanupAuditMetadata
  | ApplicationDecisionAuditMetadata
  | UserProfileAuditMetadata;

/**
 * #621 — 조회 응답 관문. `GET /audit-logs`가 응답에 실을 metadata 필드를 종류별로 여기서
 * **명시 선언**한다. 아래 `*View` 타입과 `to*View` 함수는 선언한 필드만 새 객체로 옮겨
 * 담으므로, 저장된 JSON에 무엇이 더 들어 있든 등록하지 않은 키는 응답에 나가지 않는다
 * (기본 거부). `is*AuditMetadata` 가드는 저장된 모양이 알려진 스키마인지만 보는
 * shape validator라 이 역할을 대신하지 못한다 — 검증을 통과한 값에도 등록되지 않은 키가
 * 그대로 남아 있을 수 있다.
 *
 * ⚠ `AuditLog`는 append-only 트리거(`20260731130000_enforce_audit_log_append_only`)로
 * UPDATE·DELETE가 막혀 있어 한 번 쓴 값은 지울 수 없다. 이미 쌓인 행에서 무언가를 가릴 수
 * 있는 자리는 이 조회 시점 관문이 유일하다(#570의 탈퇴자 이름 스냅샷 마스킹도 여기에 얹는다).
 */
type AccessAuditMetadataViewBase = {
  readonly eventKind: AccessAuditEventKind;
  readonly actor: AuditActorSnapshot;
  readonly before: AccessAuditState;
  readonly after: AccessAuditState;
};

// `rejectionReason`(관리자가 남긴 자유 서술)은 등록하지 않는다 — 행동 메타데이터가 아니라
// 도메인 페이로드이고, 사유 원문은 `Application.rejectionReason`이 원본이다.
export type AccessAuditMetadataView =
  | (AccessAuditMetadataViewBase & {
      readonly schemaVersion: typeof ACCESS_AUDIT_SCHEMA_VERSION_V1;
    })
  | (AccessAuditMetadataViewBase & {
      readonly schemaVersion: typeof ACCESS_AUDIT_SCHEMA_VERSION;
      readonly target: AuditTargetSnapshot;
    });

// `runId`는 등록하지 않는다 — 수집 실행 내부 식별자는 공개 노출 계약이 이 응답의 금지 키로
// 선언해 둔 값이고(`public-exposure-persona.http.integration.spec.ts`), 같은 값이 이미
// 감사 행의 `targetId`로 나가므로 metadata 사본을 둘 이유가 없다.
export type CollectionTriggerAuditMetadataView = Omit<
  CollectionTriggerAuditMetadata,
  'runId'
>;

// v1(저장소 전체 이름 스냅샷 없음)은 그대로, v2는 repositoryFullName을 함께 등록한다.
export type RepositoryPublishAuditMetadataView =
  RepositoryPublishAuditMetadataV1 | RepositoryPublishAuditMetadataV2;

// v1(이름 스냅샷 없음)은 그대로, v2는 programName을 함께 등록한다.
export type ProgramLifecycleAuditMetadataView =
  | (Omit<ProgramLifecycleAuditMetadataV1, 'schemaVersion'> & {
      readonly schemaVersion: typeof PROGRAM_LIFECYCLE_AUDIT_SCHEMA_VERSION_V1;
    })
  | (Omit<ProgramLifecycleAuditMetadataV2, 'schemaVersion'> & {
      readonly schemaVersion: typeof PROGRAM_LIFECYCLE_AUDIT_SCHEMA_VERSION;
    });

// v1(이름 스냅샷 없음)은 그대로, v2는 programName·applicantGithubLogin을 함께
// 등록한다. 신청자 실명은 애초에 metadata에 담지 않으므로(위 클래스 주석 참고) 여기서도
// 가릴 것이 없다.
export type ApplicationDecisionAuditMetadataView =
  ApplicationDecisionAuditMetadataV1 | ApplicationDecisionAuditMetadataV2;

// 세 필드 모두 조회 응답에 그대로 나간다 — `GET /audit-logs`는 이미 ADMIN 전용이고,
// 이 기능의 요지가 "무엇이 바뀌었는지" 그 자체이므로 가릴 이유가 없다.
export type UserProfileAuditMetadataView = UserProfileAuditMetadata;

// 네 필드 모두 조회 응답에 그대로 나간다 — programName·lifecycle·blockingCounts는
// 사람 신원이 아니라 "무엇을, 왜 지울 수 있었는지"를 말하는 행동 메타데이터다.
export type ProgramDeletionAuditMetadataView = ProgramDeletionAuditMetadata;

export type AuditLogMetadataView =
  | AccessAuditMetadataView
  | RepositoryPublishAuditMetadataView
  | ProgramLifecycleAuditMetadataView
  | ProgramDeletionAuditMetadataView
  | CollectionTriggerAuditMetadataView
  | SubmissionFileCleanupAuditMetadata
  | ApplicationDecisionAuditMetadataView
  | UserProfileAuditMetadataView;

function toAuditPersonSnapshotView(
  snapshot: AuditPersonSnapshot,
): AuditPersonSnapshot {
  return {
    displayName: snapshot.displayName,
    githubLogin: snapshot.githubLogin,
  };
}

function toAccessAuditStateView(state: AccessAuditState): AccessAuditState {
  return {
    role: state.role,
    accountStatus: state.accountStatus,
    requestStatus: state.requestStatus,
  };
}

function toAccessAuditMetadataView(
  metadata: AccessAuditMetadata,
): AccessAuditMetadataView {
  const base = {
    eventKind: metadata.eventKind,
    actor: toAuditPersonSnapshotView(metadata.actor),
    before: toAccessAuditStateView(metadata.before),
    after: toAccessAuditStateView(metadata.after),
  };
  return metadata.schemaVersion === ACCESS_AUDIT_SCHEMA_VERSION
    ? {
        ...base,
        schemaVersion: ACCESS_AUDIT_SCHEMA_VERSION,
        target: toAuditPersonSnapshotView(metadata.target),
      }
    : { ...base, schemaVersion: ACCESS_AUDIT_SCHEMA_VERSION_V1 };
}

function toRepositoryPublishAuditMetadataView(
  metadata: RepositoryPublishAuditMetadata,
): RepositoryPublishAuditMetadataView {
  const base = {
    repositoryId: metadata.repositoryId,
    before: { visibility: metadata.before.visibility },
    after: {
      visibility: metadata.after.visibility,
      publishedAt: metadata.after.publishedAt,
    },
  };
  return metadata.schemaVersion === REPOSITORY_PUBLISH_AUDIT_SCHEMA_VERSION
    ? {
        ...base,
        schemaVersion: REPOSITORY_PUBLISH_AUDIT_SCHEMA_VERSION,
        repositoryFullName: metadata.repositoryFullName,
      }
    : { ...base, schemaVersion: REPOSITORY_PUBLISH_AUDIT_SCHEMA_VERSION_V1 };
}

function toProgramLifecycleAuditMetadataView(
  metadata: ProgramLifecycleAuditMetadata,
): ProgramLifecycleAuditMetadataView {
  const base = {
    before: { lifecycle: metadata.before.lifecycle },
    after: { lifecycle: metadata.after.lifecycle },
  };
  return metadata.schemaVersion === PROGRAM_LIFECYCLE_AUDIT_SCHEMA_VERSION
    ? {
        ...base,
        schemaVersion: PROGRAM_LIFECYCLE_AUDIT_SCHEMA_VERSION,
        programName: metadata.programName,
      }
    : { ...base, schemaVersion: PROGRAM_LIFECYCLE_AUDIT_SCHEMA_VERSION_V1 };
}

function toProgramDeletionAuditMetadataView(
  metadata: ProgramDeletionAuditMetadata,
): ProgramDeletionAuditMetadataView {
  return {
    schemaVersion: metadata.schemaVersion,
    programName: metadata.programName,
    lifecycle: metadata.lifecycle,
    blockingCounts: { ...metadata.blockingCounts },
  };
}

function toCollectionTriggerAuditMetadataView(
  metadata: CollectionTriggerAuditMetadata,
): CollectionTriggerAuditMetadataView {
  return { schemaVersion: metadata.schemaVersion };
}

function toSubmissionFileCleanupAuditMetadataView(
  metadata: SubmissionFileCleanupAuditMetadata,
): SubmissionFileCleanupAuditMetadata {
  return { schemaVersion: metadata.schemaVersion, fileId: metadata.fileId };
}

function toApplicationDecisionAuditMetadataView(
  metadata: ApplicationDecisionAuditMetadata,
): ApplicationDecisionAuditMetadataView {
  const base = {
    before: { status: metadata.before.status },
    after: { status: metadata.after.status },
  };
  return metadata.schemaVersion === APPLICATION_DECISION_AUDIT_SCHEMA_VERSION
    ? {
        ...base,
        schemaVersion: APPLICATION_DECISION_AUDIT_SCHEMA_VERSION,
        programName: metadata.programName,
        applicantGithubLogin: metadata.applicantGithubLogin,
      }
    : {
        ...base,
        schemaVersion: APPLICATION_DECISION_AUDIT_SCHEMA_VERSION_V1,
      };
}

function toUserProfileAuditMetadataView(
  metadata: UserProfileAuditMetadata,
): UserProfileAuditMetadataView {
  return {
    schemaVersion: metadata.schemaVersion,
    actor: toAuditPersonSnapshotView(metadata.actor),
    target: toAuditPersonSnapshotView(metadata.target),
    changes: metadata.changes.map((change) => ({
      field: change.field,
      before: change.before,
      after: change.after,
    })),
  };
}

export type AuditLogMetadataEvidence =
  | { readonly legacy: true; readonly metadata: null }
  | { readonly legacy: false; readonly metadata: AuditLogMetadataView };

export class InvalidAuditLogMetadataError extends Error {
  constructor() {
    super('Audit log metadata does not match a known audit schema version.');
    this.name = 'InvalidAuditLogMetadataError';
  }
}

export function createAccessAuditMetadata(
  input: AccessAuditMetadataInput,
): AccessAuditMetadataV2 {
  return { schemaVersion: ACCESS_AUDIT_SCHEMA_VERSION, ...input };
}

/**
 * 저장된 metadata JSON을 알려진 스키마로 판별하고, 그 종류에 등록된 필드만 남긴 조회용
 * 형태(`AuditLogMetadataView`)로 되돌린다 — 판별과 관문이 같은 자리에 있어야 새 종류를
 * 추가할 때 관문 등록을 빠뜨릴 수 없다.
 *
 * 어느 종류로도 판별되지 않는 모양은 통째로 버리거나 빈 객체로 만들지 않고 던진다. 조용히
 * 비우면 "읽기 가드를 빠뜨렸다"는 사실이 빈 metadata로 위장돼, append-only라 다시 쓸 수도
 * 없는 행이 영구히 설명 불가능한 상태로 남는다. 기본 거부는 지키면서(어떤 키도 나가지
 * 않는다) 등록 누락은 소리 나게 실패하는 쪽을 택한다.
 */
export function parseAuditLogMetadata(
  value: unknown,
): AuditLogMetadataEvidence {
  if (isJsonObject(value) && Object.keys(value).length === 0) {
    return { legacy: true, metadata: null };
  }
  if (isAccessAuditMetadata(value)) {
    return { legacy: false, metadata: toAccessAuditMetadataView(value) };
  }
  if (isRepositoryPublishAuditMetadata(value)) {
    return {
      legacy: false,
      metadata: toRepositoryPublishAuditMetadataView(value),
    };
  }
  if (isProgramLifecycleAuditMetadata(value)) {
    return {
      legacy: false,
      metadata: toProgramLifecycleAuditMetadataView(value),
    };
  }
  if (isProgramDeletionAuditMetadata(value)) {
    return {
      legacy: false,
      metadata: toProgramDeletionAuditMetadataView(value),
    };
  }
  if (isCollectionTriggerAuditMetadata(value)) {
    return {
      legacy: false,
      metadata: toCollectionTriggerAuditMetadataView(value),
    };
  }
  if (isSubmissionFileCleanupAuditMetadata(value)) {
    return {
      legacy: false,
      metadata: toSubmissionFileCleanupAuditMetadataView(value),
    };
  }
  if (isApplicationDecisionAuditMetadata(value)) {
    return {
      legacy: false,
      metadata: toApplicationDecisionAuditMetadataView(value),
    };
  }
  if (isUserProfileAuditMetadata(value)) {
    return { legacy: false, metadata: toUserProfileAuditMetadataView(value) };
  }
  throw new InvalidAuditLogMetadataError();
}

function isUserProfileAuditMetadata(
  value: unknown,
): value is UserProfileAuditMetadata {
  return (
    isJsonObject(value) &&
    value.schemaVersion === USER_PROFILE_AUDIT_SCHEMA_VERSION &&
    isAuditPersonSnapshot(value.actor) &&
    isAuditPersonSnapshot(value.target) &&
    Array.isArray(value.changes) &&
    value.changes.every(isUserProfileAuditFieldChange)
  );
}

function isUserProfileAuditFieldChange(
  value: unknown,
): value is UserProfileAuditFieldChange {
  return (
    isJsonObject(value) &&
    (value.field === USER_PROFILE_AUDIT_FIELDS.NAME ||
      value.field === USER_PROFILE_AUDIT_FIELDS.STUDENT_ID ||
      value.field === USER_PROFILE_AUDIT_FIELDS.DEPARTMENT) &&
    (typeof value.before === 'string' || value.before === null) &&
    (typeof value.after === 'string' || value.after === null)
  );
}

function isCollectionTriggerAuditMetadata(
  value: unknown,
): value is CollectionTriggerAuditMetadata {
  return (
    isJsonObject(value) &&
    value.schemaVersion === COLLECTION_TRIGGER_AUDIT_SCHEMA_VERSION &&
    typeof value.runId === 'string'
  );
}

function isSubmissionFileCleanupAuditMetadata(
  value: unknown,
): value is SubmissionFileCleanupAuditMetadata {
  return (
    isJsonObject(value) &&
    value.schemaVersion === SUBMISSION_FILE_CLEANUP_AUDIT_SCHEMA_VERSION &&
    typeof value.fileId === 'string'
  );
}

function isApplicationDecisionAuditMetadata(
  value: unknown,
): value is ApplicationDecisionAuditMetadata {
  if (
    !isJsonObject(value) ||
    !isApplicationDecisionState(value.before) ||
    !isApplicationDecisionState(value.after) ||
    // 반려 사유 원문이 섞여 들어오면 알 수 없는 스키마로 취급한다 — append-only 원장이라
    // 나중에 지울 수 없으니, 쓰기 경로가 실수로 담는 순간 여기서 막힌다.
    'rejectionReason' in value
  ) {
    return false;
  }
  if (value.schemaVersion === APPLICATION_DECISION_AUDIT_SCHEMA_VERSION) {
    return (
      typeof value.programName === 'string' &&
      typeof value.applicantGithubLogin === 'string'
    );
  }
  return value.schemaVersion === APPLICATION_DECISION_AUDIT_SCHEMA_VERSION_V1;
}

function isApplicationDecisionState(
  value: unknown,
): value is { readonly status: ApplicationStatus } {
  return (
    isJsonObject(value) &&
    typeof value.status === 'string' &&
    Object.values(ApplicationStatus).includes(value.status as ApplicationStatus)
  );
}

function isRepositoryPublishAuditMetadata(
  value: unknown,
): value is RepositoryPublishAuditMetadata {
  if (
    !isJsonObject(value) ||
    typeof value.repositoryId !== 'string' ||
    !isRepositoryPublishAuditVisibilityState(value.before) ||
    !isRepositoryPublishAuditVisibilityState(value.after) ||
    typeof (value.after as { publishedAt?: unknown }).publishedAt !== 'string'
  ) {
    return false;
  }
  if (value.schemaVersion === REPOSITORY_PUBLISH_AUDIT_SCHEMA_VERSION) {
    return typeof value.repositoryFullName === 'string';
  }
  return value.schemaVersion === REPOSITORY_PUBLISH_AUDIT_SCHEMA_VERSION_V1;
}

function isRepositoryPublishAuditVisibilityState(
  value: unknown,
): value is RepositoryPublishAuditVisibilityState {
  return (
    isJsonObject(value) &&
    (value.visibility === RepositoryVisibility.PRIVATE ||
      value.visibility === RepositoryVisibility.PUBLIC)
  );
}
function isProgramLifecycleAuditMetadata(
  value: unknown,
): value is ProgramLifecycleAuditMetadata {
  if (
    !isJsonObject(value) ||
    !isProgramLifecycleState(value.before) ||
    !isProgramLifecycleState(value.after)
  ) {
    return false;
  }
  if (value.schemaVersion === PROGRAM_LIFECYCLE_AUDIT_SCHEMA_VERSION) {
    return typeof value.programName === 'string';
  }
  return value.schemaVersion === PROGRAM_LIFECYCLE_AUDIT_SCHEMA_VERSION_V1;
}

function isProgramLifecycleState(
  value: unknown,
): value is { readonly lifecycle: ProgramLifecycle } {
  return (
    isJsonObject(value) &&
    (value.lifecycle === ProgramLifecycle.PUBLISHED ||
      value.lifecycle === ProgramLifecycle.ARCHIVED)
  );
}

function isProgramDeletionAuditMetadata(
  value: unknown,
): value is ProgramDeletionAuditMetadata {
  return (
    isJsonObject(value) &&
    value.schemaVersion === PROGRAM_DELETION_AUDIT_SCHEMA_VERSION &&
    typeof value.programName === 'string' &&
    (value.lifecycle === ProgramLifecycle.PUBLISHED ||
      value.lifecycle === ProgramLifecycle.ARCHIVED) &&
    isProgramDeletionAuditBlockingCounts(value.blockingCounts)
  );
}

function isProgramDeletionAuditBlockingCounts(
  value: unknown,
): value is ProgramDeletionAuditBlockingCounts {
  return (
    isJsonObject(value) &&
    typeof value.applications === 'number' &&
    typeof value.teams === 'number' &&
    typeof value.submissions === 'number' &&
    typeof value.boardPosts === 'number'
  );
}

function isAccessAuditMetadata(value: unknown): value is AccessAuditMetadata {
  if (
    !isJsonObject(value) ||
    !isAuditPersonSnapshot(value.actor) ||
    !isAccessAuditState(value.before) ||
    !isAccessAuditState(value.after)
  ) {
    return false;
  }
  if (value.schemaVersion === ACCESS_AUDIT_SCHEMA_VERSION) {
    if (!isAuditPersonSnapshot(value.target)) {
      return false;
    }
  } else if (value.schemaVersion !== ACCESS_AUDIT_SCHEMA_VERSION_V1) {
    return false;
  }

  switch (value.eventKind) {
    case ACCESS_AUDIT_EVENT_KINDS.ROLE_REQUEST_REJECTED:
      return typeof value.rejectionReason === 'string';
    case ACCESS_AUDIT_EVENT_KINDS.ROLE_REQUEST_APPROVED:
    case ACCESS_AUDIT_EVENT_KINDS.ROLE_REQUEST_REVOKED:
    case ACCESS_AUDIT_EVENT_KINDS.ROLE_REQUEST_RESTORED:
    case ACCESS_AUDIT_EVENT_KINDS.DIRECT_ROLE_CHANGED:
    case ACCESS_AUDIT_EVENT_KINDS.ACCOUNT_STATUS_CHANGED:
      return !('rejectionReason' in value);
    default:
      return false;
  }
}

function isAuditPersonSnapshot(value: unknown): value is AuditPersonSnapshot {
  return (
    isJsonObject(value) &&
    (typeof value.displayName === 'string' || value.displayName === null) &&
    typeof value.githubLogin === 'string'
  );
}

function isAccessAuditState(value: unknown): value is AccessAuditState {
  return (
    isJsonObject(value) &&
    isRole(value.role) &&
    isAccountStatus(value.accountStatus) &&
    isRoleRequestStatus(value.requestStatus)
  );
}

function isRole(value: unknown): value is Role | null {
  return (
    value === null ||
    value === Role.STUDENT ||
    value === Role.STAFF ||
    value === Role.ADMIN
  );
}

function isAccountStatus(value: unknown): value is AccountStatus {
  return value === AccountStatus.ACTIVE || value === AccountStatus.DEACTIVATED;
}

function isRoleRequestStatus(
  value: unknown,
): value is RoleRequestStatus | null {
  return (
    value === null ||
    value === RoleRequestStatus.PENDING ||
    value === RoleRequestStatus.APPROVED ||
    value === RoleRequestStatus.REJECTED ||
    value === RoleRequestStatus.REVOKED
  );
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
