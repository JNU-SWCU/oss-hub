import { isJsonObject } from './audit-metadata-validation';

export const PROGRAM_CREATED_AUDIT_SCHEMA_VERSION = 1 as const;
export const PROGRAM_CREATED_AUDIT_ACTIONS = {
  PROGRAM_CREATED: 'PROGRAM_CREATED',
} as const;
export type ProgramCreatedAuditMetadata = {
  readonly schemaVersion: typeof PROGRAM_CREATED_AUDIT_SCHEMA_VERSION;
  readonly programName: string;
};
export type ProgramCreatedAuditMetadataView = ProgramCreatedAuditMetadata;
export function createProgramCreatedAuditMetadata(
  input: Omit<ProgramCreatedAuditMetadata, 'schemaVersion'>,
): ProgramCreatedAuditMetadata {
  return { schemaVersion: PROGRAM_CREATED_AUDIT_SCHEMA_VERSION, ...input };
}

export const TEAM_CREATED_AUDIT_SCHEMA_VERSION = 1 as const;
export const TEAM_CREATED_AUDIT_ACTIONS = {
  TEAM_CREATED: 'TEAM_CREATED',
} as const;
export type TeamCreatedAuditMetadata = {
  readonly schemaVersion: typeof TEAM_CREATED_AUDIT_SCHEMA_VERSION;
  readonly programName: string;
  readonly teamName: string;
};
export type TeamCreatedAuditMetadataView = TeamCreatedAuditMetadata;
export function createTeamCreatedAuditMetadata(
  input: Omit<TeamCreatedAuditMetadata, 'schemaVersion'>,
): TeamCreatedAuditMetadata {
  return { schemaVersion: TEAM_CREATED_AUDIT_SCHEMA_VERSION, ...input };
}

export const TEAM_JOINED_AUDIT_SCHEMA_VERSION = 1 as const;
export const TEAM_JOINED_AUDIT_ACTIONS = {
  TEAM_JOINED: 'TEAM_JOINED',
} as const;
export type TeamJoinedAuditMetadata = {
  readonly schemaVersion: typeof TEAM_JOINED_AUDIT_SCHEMA_VERSION;
  readonly programName: string;
  readonly teamName: string;
};
export type TeamJoinedAuditMetadataView = TeamJoinedAuditMetadata;
export function createTeamJoinedAuditMetadata(
  input: Omit<TeamJoinedAuditMetadata, 'schemaVersion'>,
): TeamJoinedAuditMetadata {
  return { schemaVersion: TEAM_JOINED_AUDIT_SCHEMA_VERSION, ...input };
}

export const APPLICATION_SUBMITTED_AUDIT_SCHEMA_VERSION = 1 as const;
export const APPLICATION_SUBMITTED_AUDIT_ACTIONS = {
  APPLICATION_SUBMITTED: 'APPLICATION_SUBMITTED',
} as const;
export type ApplicationSubmittedAuditMetadata = {
  readonly schemaVersion: typeof APPLICATION_SUBMITTED_AUDIT_SCHEMA_VERSION;
  readonly programName: string;
  readonly teamName: string;
};
export type ApplicationSubmittedAuditMetadataView =
  ApplicationSubmittedAuditMetadata;
export function createApplicationSubmittedAuditMetadata(
  input: Omit<ApplicationSubmittedAuditMetadata, 'schemaVersion'>,
): ApplicationSubmittedAuditMetadata {
  return {
    schemaVersion: APPLICATION_SUBMITTED_AUDIT_SCHEMA_VERSION,
    ...input,
  };
}

export const TEAM_MEMBERSHIP_AUDIT_SCHEMA_VERSION = 1 as const;
export const TEAM_MEMBERSHIP_AUDIT_ACTIONS = {
  TEAM_MEMBERSHIP_CHANGED: 'TEAM_MEMBERSHIP_CHANGED',
} as const;
export const TEAM_MEMBERSHIP_AUDIT_OPERATIONS = {
  LEAVE: 'LEAVE',
  REMOVE: 'REMOVE',
} as const;
export type TeamMembershipAuditOperation =
  (typeof TEAM_MEMBERSHIP_AUDIT_OPERATIONS)[keyof typeof TEAM_MEMBERSHIP_AUDIT_OPERATIONS];
// 팀 자진 탈퇴/팀원 내보내기 한 번을 한 행으로 남긴다. 자동 팀장 승계가 같은
// 트랜잭션에서 일어나므로 "누가 빠졌는지"와 "팀장 권한이 어디로 옮겨갔는지"를 한
// 스냅샷에 함께 봉인한다. nextLeaderId는 마지막 인원이 미제출 팀을 떠나 팀 자체가
// 삭제된 경우에만 null이다 — 승계 대상이 존재하지 않았다는 사실 자체가 감사 사실이다.
// user id는 계정 식별자가 아니라 내부 대상 식별자이므로 실명/이메일/join code와 달리
// 기록한다(ADR-007: 조회 시점 User 재조회로 과거 사실을 복원하지 않는다).
export type TeamMembershipAuditMetadata = {
  readonly schemaVersion: typeof TEAM_MEMBERSHIP_AUDIT_SCHEMA_VERSION;
  readonly programName: string;
  readonly teamName: string;
  readonly operation: TeamMembershipAuditOperation;
  readonly removedUserId: string;
  readonly previousLeaderId: string;
  readonly nextLeaderId: string | null;
};
export type TeamMembershipAuditMetadataView = TeamMembershipAuditMetadata;
export function createTeamMembershipAuditMetadata(
  input: Omit<TeamMembershipAuditMetadata, 'schemaVersion'>,
): TeamMembershipAuditMetadata {
  return { schemaVersion: TEAM_MEMBERSHIP_AUDIT_SCHEMA_VERSION, ...input };
}

export const TEAM_RENAMED_AUDIT_SCHEMA_VERSION = 1 as const;
export const TEAM_RENAMED_AUDIT_ACTIONS = {
  TEAM_RENAMED: 'TEAM_RENAMED',
} as const;
// 팀 이름 변경 한 번을 한 행으로 남긴다. `teamName`은 바뀐 **뒤**의 이름이고
// `previousName`이 바뀌기 전 이름이다 — 두 값이 한 스냅샷에 함께 있어야 「무엇이
// 무엇으로 바뀌었는가」가 Team 재조회 없이 복원된다(ADR-007: 조회 시점 재조회로
// 과거 사실을 복원하지 않는다). 행위자가 팀장인지 교직원인지는 `actorId`가 말하므로
// metadata에 다시 적지 않는다.
export type TeamRenamedAuditMetadata = {
  readonly schemaVersion: typeof TEAM_RENAMED_AUDIT_SCHEMA_VERSION;
  readonly programName: string;
  readonly teamName: string;
  readonly previousName: string;
};
export type TeamRenamedAuditMetadataView = TeamRenamedAuditMetadata;
export function createTeamRenamedAuditMetadata(
  input: Omit<TeamRenamedAuditMetadata, 'schemaVersion'>,
): TeamRenamedAuditMetadata {
  return { schemaVersion: TEAM_RENAMED_AUDIT_SCHEMA_VERSION, ...input };
}

export const TEAM_DELETED_AUDIT_SCHEMA_VERSION = 1 as const;
export const TEAM_DELETED_AUDIT_ACTIONS = {
  TEAM_DELETED: 'TEAM_DELETED',
} as const;
/**
 * 교직원이 지운 팀 하나를 한 행으로 남긴다. 팀과 함께 사라진 것의 수치를 같은 스냅샷에
 * 봉인하는 이유는 ADR-007과 같다 — 행이 이미 없어서 조회 시점에 다시 셀 수 없다.
 * `detachedRepositories`만 뜻이 다르다: 지워진 수가 아니라 **연결만 끊긴** 저장소 수이며,
 * 수집 이력이 그 아래 매달려 있어 행 자체는 남는다.
 */
export type TeamDeletedAuditCounts = {
  readonly applications: number;
  readonly members: number;
  readonly invitations: number;
  readonly submissions: number;
  readonly submissionEvents: number;
  readonly detachedRepositories: number;
};
export type TeamDeletedAuditMetadata = {
  readonly schemaVersion: typeof TEAM_DELETED_AUDIT_SCHEMA_VERSION;
  readonly programName: string;
  readonly teamName: string;
  readonly deletedCounts: TeamDeletedAuditCounts;
};
export type TeamDeletedAuditMetadataView = TeamDeletedAuditMetadata;
export function createTeamDeletedAuditMetadata(
  input: Omit<TeamDeletedAuditMetadata, 'schemaVersion'>,
): TeamDeletedAuditMetadata {
  return { schemaVersion: TEAM_DELETED_AUDIT_SCHEMA_VERSION, ...input };
}

const TEAM_DELETED_COUNT_KEYS = [
  'applications',
  'members',
  'invitations',
  'submissions',
  'submissionEvents',
  'detachedRepositories',
] as const;

const FORBIDDEN_KEYS = [
  'answers',
  'joinCode',
  'joinCodeDigest',
  'name',
  'studentId',
  'email',
  'rejectionReason',
  'applicantGithubLogin',
  'target',
] as const;

// 이 키들이 있으면 팀 상태 metadata는 "팀 구성 변경 사실을 담으려던 행"이다.
// TEAM_CREATED/TEAM_JOINED/APPLICATION_SUBMITTED는 programName·teamName만 보므로,
// 예약하지 않으면 검증에 실패한 팀 구성 payload가 이름 두 개짜리 행으로 조용히
// 격하되어 탈퇴/승계 사실이 사라진다.
const TEAM_MEMBERSHIP_RESERVED_KEYS = [
  'operation',
  'removedUserId',
  'previousLeaderId',
  'nextLeaderId',
] as const;

// TEAM_MEMBERSHIP_RESERVED_KEYS와 같은 이유로 예약한다 — TEAM_CREATED/TEAM_JOINED/
// APPLICATION_SUBMITTED는 programName·teamName만 보므로, 예약하지 않으면 검증에
// 실패한 이름 변경 payload가 「팀이 생성됐다」는 다른 사실로 조용히 격하되고
// 바뀌기 전 이름이 사라진다.
const TEAM_RENAMED_RESERVED_KEYS = ['previousName'] as const;

// 같은 이유로 예약한다 — 예약하지 않으면 검증에 실패한 삭제 payload가 「팀이 생성됐다」는
// 정반대 사실로 조용히 격하되고, 함께 사라진 것의 수치가 통째로 없어진다.
const TEAM_DELETED_RESERVED_KEYS = ['deletedCounts'] as const;

/**
 * 삭제는 `deletedCounts`가 있어야만 성립한다 — 그 수치가 없으면 무엇이 함께 사라졌는지를
 * 말할 수 없고, 팀이 사라진 뒤에는 다시 셀 방법도 없다.
 */
export function parseTeamDeletedAuditMetadata(
  value: unknown,
): TeamDeletedAuditMetadataView | null {
  if (!isTeamStateShape(value, TEAM_DELETED_AUDIT_SCHEMA_VERSION)) {
    return null;
  }
  const { deletedCounts } = value;
  if (!isTeamDeletedCounts(deletedCounts)) return null;

  return {
    schemaVersion: TEAM_DELETED_AUDIT_SCHEMA_VERSION,
    programName: value.programName,
    teamName: value.teamName,
    deletedCounts,
  };
}

function isTeamDeletedCounts(value: unknown): value is TeamDeletedAuditCounts {
  if (!isJsonObject(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.length === TEAM_DELETED_COUNT_KEYS.length &&
    TEAM_DELETED_COUNT_KEYS.every((key) => Number.isInteger(value[key]))
  );
}

/**
 * 이름 변경은 `previousName`이 있어야만 성립한다 — 그 키가 없으면 어떤 이름에서
 * 왔는지를 말할 수 없고, 그건 이름 변경 사실이 아니다.
 */
export function parseTeamRenamedAuditMetadata(
  value: unknown,
): TeamRenamedAuditMetadataView | null {
  if (!isTeamStateShape(value, TEAM_RENAMED_AUDIT_SCHEMA_VERSION)) {
    return null;
  }
  const { previousName } = value;

  return typeof previousName === 'string'
    ? {
        schemaVersion: TEAM_RENAMED_AUDIT_SCHEMA_VERSION,
        programName: value.programName,
        teamName: value.teamName,
        previousName,
      }
    : null;
}

export function parseTeamMembershipAuditMetadata(
  value: unknown,
): TeamMembershipAuditMetadataView | null {
  if (!isTeamStateShape(value, TEAM_MEMBERSHIP_AUDIT_SCHEMA_VERSION)) {
    return null;
  }
  const { operation, removedUserId, previousLeaderId, nextLeaderId } = value;

  return isTeamMembershipOperation(operation) &&
    typeof removedUserId === 'string' &&
    typeof previousLeaderId === 'string' &&
    (nextLeaderId === null || typeof nextLeaderId === 'string')
    ? {
        schemaVersion: TEAM_MEMBERSHIP_AUDIT_SCHEMA_VERSION,
        programName: value.programName,
        teamName: value.teamName,
        operation,
        removedUserId,
        previousLeaderId,
        nextLeaderId,
      }
    : null;
}

export function parseProgramCreatedAuditMetadata(
  value: unknown,
): ProgramCreatedAuditMetadataView | null {
  return isBase(value, PROGRAM_CREATED_AUDIT_SCHEMA_VERSION) &&
    !('teamName' in value) &&
    !('lifecycle' in value) &&
    !('blockingCounts' in value) &&
    !('before' in value) &&
    !('after' in value)
    ? {
        schemaVersion: PROGRAM_CREATED_AUDIT_SCHEMA_VERSION,
        programName: value.programName,
      }
    : null;
}

export function parseTeamCreatedAuditMetadata(
  value: unknown,
): TeamCreatedAuditMetadataView | null {
  return isTeamState(value, TEAM_CREATED_AUDIT_SCHEMA_VERSION)
    ? {
        schemaVersion: TEAM_CREATED_AUDIT_SCHEMA_VERSION,
        programName: value.programName,
        teamName: value.teamName,
      }
    : null;
}

export function parseTeamJoinedAuditMetadata(
  value: unknown,
): TeamJoinedAuditMetadataView | null {
  return isTeamState(value, TEAM_JOINED_AUDIT_SCHEMA_VERSION)
    ? {
        schemaVersion: TEAM_JOINED_AUDIT_SCHEMA_VERSION,
        programName: value.programName,
        teamName: value.teamName,
      }
    : null;
}

export function parseApplicationSubmittedAuditMetadata(
  value: unknown,
): ApplicationSubmittedAuditMetadataView | null {
  return isTeamState(value, APPLICATION_SUBMITTED_AUDIT_SCHEMA_VERSION) &&
    !('applicantGithubLogin' in value)
    ? {
        schemaVersion: APPLICATION_SUBMITTED_AUDIT_SCHEMA_VERSION,
        programName: value.programName,
        teamName: value.teamName,
      }
    : null;
}

function isTeamState(
  value: unknown,
  schemaVersion: number,
): value is Record<string, unknown> & {
  readonly programName: string;
  readonly teamName: string;
} {
  return (
    isTeamStateShape(value, schemaVersion) &&
    !TEAM_MEMBERSHIP_RESERVED_KEYS.some((key) => key in value) &&
    !TEAM_RENAMED_RESERVED_KEYS.some((key) => key in value) &&
    !TEAM_DELETED_RESERVED_KEYS.some((key) => key in value)
  );
}
function isTeamStateShape(
  value: unknown,
  schemaVersion: number,
): value is Record<string, unknown> & {
  readonly programName: string;
  readonly teamName: string;
} {
  return isBase(value, schemaVersion) && typeof value.teamName === 'string';
}
function isTeamMembershipOperation(
  value: unknown,
): value is TeamMembershipAuditOperation {
  return (
    value === TEAM_MEMBERSHIP_AUDIT_OPERATIONS.LEAVE ||
    value === TEAM_MEMBERSHIP_AUDIT_OPERATIONS.REMOVE
  );
}
function isBase(
  value: unknown,
  schemaVersion: number,
): value is Record<string, unknown> & { readonly programName: string } {
  return (
    isJsonObject(value) &&
    value.schemaVersion === schemaVersion &&
    typeof value.programName === 'string' &&
    !FORBIDDEN_KEYS.some((key) => key in value)
  );
}
