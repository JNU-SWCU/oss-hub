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
    !TEAM_MEMBERSHIP_RESERVED_KEYS.some((key) => key in value)
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
