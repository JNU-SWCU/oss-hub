import type {
  MyRepositories,
  MyRepositoriesResponse,
  MyRepositoryResponseItem,
  RepositoryApplicationMode,
  RepositoryInvitationStatus,
  RepositoryProvisionStatus,
  RepositoryVisibility,
} from './types';

const INVALID_RESPONSE_MESSAGE = '내 저장소 응답 형식이 올바르지 않습니다';

class MyRepositoriesResponseError extends Error {
  constructor() {
    super(INVALID_RESPONSE_MESSAGE);
    this.name = 'MyRepositoriesResponseError';
  }
}

function invalidResponse(): never {
  throw new MyRepositoriesResponseError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string {
  if (typeof value === 'string' && value.trim().length > 0) return value;
  return invalidResponse();
}

function nullableString(value: unknown): string | null {
  if (value === null || typeof value === 'string') return value;
  return invalidResponse();
}

function applicationMode(value: unknown): RepositoryApplicationMode {
  if (value === 'PERSONAL' || value === 'TEAM') return value;
  return invalidResponse();
}

function provisionStatus(value: unknown): RepositoryProvisionStatus {
  if (
    value === 'PENDING' ||
    value === 'PROCESSING' ||
    value === 'SUCCEEDED' ||
    value === 'FAILED_RETRYABLE' ||
    value === 'FAILED_FINAL'
  ) {
    return value;
  }
  return invalidResponse();
}

function invitationStatus(value: unknown): RepositoryInvitationStatus {
  if (
    value === null ||
    value === 'PENDING' ||
    value === 'SUCCEEDED' ||
    value === 'FAILED_RETRYABLE' ||
    value === 'FAILED_FINAL'
  ) {
    return value;
  }
  return invalidResponse();
}

function nullableVisibility(value: unknown): RepositoryVisibility | null {
  if (value === null || value === 'PRIVATE' || value === 'PUBLIC') return value;
  return invalidResponse();
}

function isSafeGithubUrl(value: string, repositoryName: string): boolean {
  try {
    const url = new URL(value);
    const pathSegments = url.pathname.split('/').filter(Boolean);
    return (
      value === `https://github.com/JNU-SWCU/${repositoryName}` &&
      url.origin === 'https://github.com' &&
      url.username === '' &&
      url.password === '' &&
      url.search === '' &&
      url.hash === '' &&
      pathSegments.length === 2 &&
      pathSegments[0] === 'JNU-SWCU' &&
      pathSegments[1] === repositoryName
    );
  } catch {
    return false;
  }
}

function responseItem(value: unknown): MyRepositoryResponseItem {
  if (!isRecord(value)) return invalidResponse();
  const updatedAt = nonEmptyString(value.updatedAt);
  const parsedUpdatedAt = new Date(updatedAt);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(updatedAt) ||
    Number.isNaN(parsedUpdatedAt.getTime()) ||
    parsedUpdatedAt.toISOString() !== updatedAt
  ) {
    return invalidResponse();
  }

  const parsedProvisionStatus = provisionStatus(value.provisionStatus);
  const repositoryId = nullableString(value.repositoryId);
  const repositoryName = nullableString(value.repositoryName);
  const githubUrl = nullableString(value.githubUrl);
  const parsedVisibility = nullableVisibility(value.visibility);
  const parsedInvitationStatus = invitationStatus(value.invitationStatus);

  if (parsedProvisionStatus === 'SUCCEEDED') {
    if (
      repositoryId === null ||
      repositoryId.trim().length === 0 ||
      repositoryName === null ||
      repositoryName.trim().length === 0 ||
      githubUrl === null ||
      parsedVisibility === null ||
      !isSafeGithubUrl(githubUrl, repositoryName)
    ) {
      return invalidResponse();
    }
  } else if (
    repositoryId !== null ||
    repositoryName !== null ||
    githubUrl !== null ||
    parsedVisibility !== null ||
    parsedInvitationStatus !== null
  ) {
    return invalidResponse();
  }

  return {
    repositoryId,
    applicationId: nonEmptyString(value.applicationId),
    applicationMode: applicationMode(value.applicationMode),
    programName: nonEmptyString(value.programName),
    displayName: nonEmptyString(value.displayName),
    repositoryName,
    githubUrl,
    provisionStatus: parsedProvisionStatus,
    invitationStatus: parsedInvitationStatus,
    visibility: parsedVisibility,
    lastErrorCode: nullableString(value.lastErrorCode),
    updatedAt,
  };
}

function response(value: unknown): MyRepositoriesResponse {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    return invalidResponse();
  }
  return { items: value.items.map(responseItem) };
}

const PROVISION_LABELS = {
  PENDING: '저장소 생성 중',
  PROCESSING: '저장소 생성 중',
  SUCCEEDED: '생성 완료',
  FAILED_RETRYABLE: '자동 재시도 중',
  FAILED_FINAL: '담당자 확인 필요',
} as const satisfies Readonly<Record<RepositoryProvisionStatus, string>>;

const INVITATION_LABELS = {
  PENDING: '초대 수락 대기',
  SUCCEEDED: '초대 완료',
  FAILED_RETRYABLE: '초대 자동 재시도 중',
  FAILED_FINAL: '초대 확인 필요',
} as const satisfies Readonly<
  Record<Exclude<RepositoryInvitationStatus, null>, string>
>;

export function parseMyRepositoriesResponse(value: unknown): MyRepositories {
  const parsed = response(value);
  return {
    items: parsed.items.map((item) => ({
      repositoryId: item.repositoryId,
      applicationId: item.applicationId,
      applicationMode: item.applicationMode,
      programName: item.programName,
      displayName: item.displayName,
      repositoryName: item.repositoryName,
      githubUrl: item.githubUrl,
      provisionStatus: item.provisionStatus,
      invitationStatus: item.invitationStatus,
      visibility: item.visibility,
      updatedAt: item.updatedAt,
      modeLabel: item.applicationMode === 'PERSONAL' ? '개인' : '팀',
      provisionLabel: PROVISION_LABELS[item.provisionStatus],
      invitationLabel:
        item.invitationStatus === null
          ? null
          : INVITATION_LABELS[item.invitationStatus],
      canOpenGithub:
        item.provisionStatus === 'SUCCEEDED' && item.githubUrl !== null,
    })),
  };
}
