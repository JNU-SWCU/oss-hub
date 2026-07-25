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

function visibility(value: unknown): RepositoryVisibility {
  if (value === 'PRIVATE' || value === 'PUBLIC') return value;
  return invalidResponse();
}

function responseItem(value: unknown): MyRepositoryResponseItem {
  if (!isRecord(value)) return invalidResponse();
  const updatedAt = nonEmptyString(value.updatedAt);
  if (Number.isNaN(Date.parse(updatedAt))) return invalidResponse();
  const parsedProvisionStatus = provisionStatus(value.provisionStatus);
  const githubUrl = nullableString(value.githubUrl);
  if (parsedProvisionStatus !== 'SUCCEEDED' && githubUrl !== null) {
    return invalidResponse();
  }
  if (parsedProvisionStatus === 'SUCCEEDED' && githubUrl === null) {
    return invalidResponse();
  }
  if (
    githubUrl !== null &&
    !githubUrl.startsWith('https://github.com/JNU-SWCU/')
  ) {
    return invalidResponse();
  }
  return {
    repositoryId: nonEmptyString(value.repositoryId),
    applicationId: nonEmptyString(value.applicationId),
    applicationMode: applicationMode(value.applicationMode),
    programName: nonEmptyString(value.programName),
    displayName: nonEmptyString(value.displayName),
    repositoryName: nonEmptyString(value.repositoryName),
    githubUrl,
    provisionStatus: parsedProvisionStatus,
    invitationStatus: invitationStatus(value.invitationStatus),
    visibility: visibility(value.visibility),
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
