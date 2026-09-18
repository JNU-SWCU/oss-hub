import {
  ApplicationStatus,
  RepositoryConnectionMode,
  type Prisma,
} from '@prisma/client';

export type RepositoryProvisionConnectionMode = 'NEW' | 'OWN';

export interface RepositoryProvisionEventPayload {
  readonly applicationId: string;
  readonly programId: string;
  readonly teamId: string | null;
  readonly requestedAt: string;
  readonly collaboratorGithubLogins: readonly string[];
  /**
   * 레거시 outbox row 호환: 없으면 NEW + null로 취급한다.
   * OWN이면 repositoryUrl이 연결 대상이다.
   */
  readonly repositoryConnectionMode: RepositoryProvisionConnectionMode;
  readonly repositoryUrl: string | null;
  /** 연결 변경 요청 actor. 최초 승인·레거시 요청은 null이다. */
  readonly requestedByGithubId?: string | null;
}

/**
 * 승인된 신청의 현재 팀원 기준으로 저장소 권한을 다시 맞추라는 요청.
 * provision 요청과 같은 outbox/consumer/job을 쓰고 새 queue를 만들지 않는다.
 */
export interface RepositoryAccessSyncEventPayload {
  readonly applicationId: string;
  readonly teamId: string;
  readonly requestedAt: string;
}

export const REPOSITORY_PROVISION_EVENT_TYPE =
  'REPOSITORY_PROVISION_REQUESTED' as const;

export const REPOSITORY_ACCESS_SYNC_EVENT_TYPE =
  'REPOSITORY_ACCESS_SYNC_REQUESTED' as const;

export class InvalidRepositoryProvisionEventError extends Error {
  override readonly name = 'InvalidRepositoryProvisionEventError';
}

export function parseRepositoryProvisionEvent(
  value: unknown,
): RepositoryProvisionEventPayload {
  if (!isRecord(value)) {
    throw new InvalidRepositoryProvisionEventError();
  }
  const applicationId = requiredString(value, 'applicationId');
  const programId = requiredString(value, 'programId');
  const requestedAt = requiredString(value, 'requestedAt');
  const requestedTimestamp = Date.parse(requestedAt);
  if (
    Number.isNaN(requestedTimestamp) ||
    new Date(requestedTimestamp).toISOString() !== requestedAt
  ) {
    throw new InvalidRepositoryProvisionEventError();
  }
  const teamId = value.teamId;
  if (teamId !== null && !isNonEmptyString(teamId)) {
    throw new InvalidRepositoryProvisionEventError();
  }
  const collaboratorGithubLogins = value.collaboratorGithubLogins;
  if (
    !Array.isArray(collaboratorGithubLogins) ||
    collaboratorGithubLogins.length === 0 ||
    !collaboratorGithubLogins.every(isGithubLogin)
  ) {
    throw new InvalidRepositoryProvisionEventError();
  }
  const canonicalLogins = [...new Set(collaboratorGithubLogins)].sort();
  if (
    canonicalLogins.length !== collaboratorGithubLogins.length ||
    canonicalLogins.some(
      (login, index) => login !== collaboratorGithubLogins[index],
    )
  ) {
    throw new InvalidRepositoryProvisionEventError();
  }

  const hasConnectionMode = Object.prototype.hasOwnProperty.call(
    value,
    'repositoryConnectionMode',
  );
  const hasRepositoryUrl = Object.prototype.hasOwnProperty.call(
    value,
    'repositoryUrl',
  );
  // 구 이벤트는 두 필드 모두 없다. 하나만 오면 계약 밖이다.
  if (hasConnectionMode !== hasRepositoryUrl) {
    throw new InvalidRepositoryProvisionEventError();
  }

  let repositoryConnectionMode: RepositoryProvisionConnectionMode = 'NEW';
  let repositoryUrl: string | null = null;
  if (hasConnectionMode) {
    const mode = value.repositoryConnectionMode;
    if (mode !== 'NEW' && mode !== 'OWN') {
      throw new InvalidRepositoryProvisionEventError();
    }
    repositoryConnectionMode = mode;
    const url = value.repositoryUrl;
    if (repositoryConnectionMode === 'NEW') {
      if (url !== null) {
        throw new InvalidRepositoryProvisionEventError();
      }
      repositoryUrl = null;
    } else {
      if (!isNonEmptyString(url) || !URL.canParse(url)) {
        throw new InvalidRepositoryProvisionEventError();
      }
      repositoryUrl = url;
    }
  }
  const requestedByGithubId = value.requestedByGithubId;
  if (
    requestedByGithubId !== undefined &&
    requestedByGithubId !== null &&
    (typeof requestedByGithubId !== 'string' ||
      !/^[1-9][0-9]*$/.test(requestedByGithubId))
  ) {
    throw new InvalidRepositoryProvisionEventError();
  }

  return {
    applicationId,
    programId,
    teamId,
    requestedAt,
    collaboratorGithubLogins,
    repositoryConnectionMode,
    repositoryUrl,
    ...(requestedByGithubId === undefined ? {} : { requestedByGithubId }),
  };
}

const ACCESS_SYNC_PAYLOAD_KEYS = [
  'applicationId',
  'teamId',
  'requestedAt',
] as const;

/// 계약 밖 key가 하나라도 있으면 거부한다 — 권한 동기화 payload는 확장 지점이 아니다.
export function parseRepositoryAccessSyncEvent(
  value: unknown,
): RepositoryAccessSyncEventPayload {
  if (!isRecord(value)) {
    throw new InvalidRepositoryProvisionEventError();
  }
  const keys = Object.keys(value);
  if (
    keys.length !== ACCESS_SYNC_PAYLOAD_KEYS.length ||
    !ACCESS_SYNC_PAYLOAD_KEYS.every((key) => keys.includes(key))
  ) {
    throw new InvalidRepositoryProvisionEventError();
  }
  return {
    applicationId: requiredString(value, 'applicationId'),
    teamId: requiredString(value, 'teamId'),
    requestedAt: requiredIsoTimestamp(value, 'requestedAt'),
  };
}

/**
 * 권한 동기화 대상 신청을 고르는 조건 — 「승인됨 + 새 저장소 발급 + 프로그램이
 * 발급을 켜 둔」 셋을 모두 만족하는 것만 우리가 권한을 쓰는 저장소를 갖는다.
 *
 * 팀 구성원을 바꾸는 주체가 `programs`(제거·탈퇴)와 `team-invitations`(합류) 둘이라
 * 이 조건이 양쪽에 같은 모양으로 복제돼 있었다. 정책은 발급 쪽 지식이므로 여기서
 * 한 벌로 소유하고, 조회·쓰기는 각 Repository가 자기 Prisma로 한다 — 이 모듈은
 * Prisma delegate를 들지 않는 순수 계약으로 남아야 경계를 넘어 공유될 수 있다.
 */
export function repositoryAccessSyncTargetWhere(
  teamId: string,
): Prisma.ApplicationWhereInput {
  return {
    teamId,
    status: ApplicationStatus.APPROVED,
    repositoryConnectionMode: RepositoryConnectionMode.NEW,
    program: { repositoryProvisioningEnabled: true },
  };
}

/**
 * 세 인자만으로 결정되는 순수 factory — 여기서 DB나 wall clock을 읽지 않는다.
 * 같은 (application, 시각)의 재시도만 idempotencyKey로 합쳐지고 이후 팀 변경은 새 row가 된다.
 */
export function repositoryAccessSyncEventData(
  applicationId: string,
  teamId: string,
  now: Date,
): Prisma.OutboxEventCreateManyInput {
  const requestedAt = now.toISOString();
  return {
    type: REPOSITORY_ACCESS_SYNC_EVENT_TYPE,
    aggregateType: 'Application',
    aggregateId: applicationId,
    idempotencyKey: `repository-access-sync:${applicationId}:${requestedAt}`,
    payload: { applicationId, teamId, requestedAt },
    availableAt: now,
  };
}

type UnknownRecord = { readonly [key: string]: unknown };

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(record: UnknownRecord, key: string): string {
  const value = record[key];
  if (!isNonEmptyString(value)) {
    throw new InvalidRepositoryProvisionEventError();
  }
  return value;
}

function requiredIsoTimestamp(record: UnknownRecord, key: string): string {
  const value = requiredString(record, key);
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new InvalidRepositoryProvisionEventError();
  }
  return value;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() === value && value !== '';
}

function isGithubLogin(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/.test(value)
  );
}

/**
 * GitHub login 정규화 — trim + 소문자 + 빈 값 제거 + 중복 제거 + 사전순 정렬.
 * 이 payload 계약이 `collaboratorGithubLogins`에 바로 이 모양을 요구하므로
 * 정본을 계약과 같은 자리에 둔다. fingerprint 비교가 표기·순서 차이로 흔들리면
 * 완료 직전 재확인이 매번 거짓 불일치를 내고 job이 영원히 재무장된다.
 */
export function canonicalGithubLogin(login: string | null | undefined): string {
  return (login ?? '').trim().toLowerCase();
}

export function canonicalGithubLogins(
  logins: readonly (string | null | undefined)[],
): readonly string[] {
  return [
    ...new Set(
      logins.map(canonicalGithubLogin).filter((login) => login.length > 0),
    ),
  ].sort();
}
