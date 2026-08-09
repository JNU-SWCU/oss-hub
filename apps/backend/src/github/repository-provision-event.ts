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
}

export const REPOSITORY_PROVISION_EVENT_TYPE =
  'REPOSITORY_PROVISION_REQUESTED' as const;

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

  return {
    applicationId,
    programId,
    teamId,
    requestedAt,
    collaboratorGithubLogins,
    repositoryConnectionMode,
    repositoryUrl,
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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() === value && value !== '';
}

function isGithubLogin(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/.test(value)
  );
}
