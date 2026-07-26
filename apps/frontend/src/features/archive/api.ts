import { ApiError, apiClient } from '@/lib/api-client';
import type {
  ArchiveApplicationMode,
  ArchiveCategory,
  ArchiveDetail,
  ArchiveList,
  ArchiveListItem,
} from './types';

const INVALID_RESPONSE_MESSAGE = '공개 아카이브 응답 형식이 올바르지 않습니다';

class ArchiveResponseError extends Error {
  constructor() {
    super(INVALID_RESPONSE_MESSAGE);
    this.name = 'ArchiveResponseError';
  }
}

class ArchiveLoadError extends Error {
  constructor() {
    super('공개 아카이브를 불러오지 못했습니다');
    this.name = 'ArchiveLoadError';
  }
}

export class ArchiveNotFoundError extends Error {
  constructor() {
    super('공개 프로젝트를 찾을 수 없습니다');
    this.name = 'ArchiveNotFoundError';
  }
}

function invalidResponse(): never {
  throw new ArchiveResponseError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string {
  if (typeof value === 'string' && value.trim().length > 0) return value;
  return invalidResponse();
}

function nonNegativeInteger(value: unknown): number {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return value;
  }
  return invalidResponse();
}

function positiveInteger(value: unknown): number {
  const parsed = nonNegativeInteger(value);
  if (parsed > 0) return parsed;
  return invalidResponse();
}

function repositoryId(value: unknown): string {
  const parsed = nonEmptyString(value);
  if (/^[A-Za-z0-9_-]+$/.test(parsed)) return parsed;
  return invalidResponse();
}

function applicationMode(value: unknown): ArchiveApplicationMode {
  if (value === 'PERSONAL' || value === 'TEAM') return value;
  return invalidResponse();
}

function category(value: unknown): ArchiveCategory {
  if (
    value === 'BASIC' ||
    value === 'SW_VALUE_SPREAD' ||
    value === 'OSS_CONTEST' ||
    value === 'CAPSTONE' ||
    value === 'SW_CONVERGENCE' ||
    value === 'GLOBAL_MAKERTHON' ||
    value === 'CORPORATE_INTERNSHIP'
  ) {
    return value;
  }
  return invalidResponse();
}

function isoDate(value: unknown): string {
  const parsed = nonEmptyString(value);
  const date = new Date(parsed);
  if (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(parsed) &&
    !Number.isNaN(date.getTime()) &&
    date.toISOString() === parsed
  ) {
    return parsed;
  }
  return invalidResponse();
}

function githubUrl(value: unknown, repositoryName?: string): string {
  const parsed = nonEmptyString(value);
  try {
    const url = new URL(parsed);
    const segments = url.pathname.split('/').filter(Boolean);
    const expectedName = repositoryName ?? segments[1];
    if (
      parsed === `https://github.com/JNU-SWCU/${expectedName}` &&
      url.origin === 'https://github.com' &&
      url.username === '' &&
      url.password === '' &&
      url.search === '' &&
      url.hash === '' &&
      segments.length === 2 &&
      segments[0] === 'JNU-SWCU' &&
      /^[A-Za-z0-9_.-]+$/.test(expectedName) &&
      segments[1] === expectedName
    ) {
      return parsed;
    }
  } catch {
    // Invalid URLs are untrusted API data.
  }
  return invalidResponse();
}

function detailUrl(value: unknown, id: string): string {
  const parsed = nonEmptyString(value);
  if (parsed === `/archive/${id}`) return parsed;
  return invalidResponse();
}

function listItem(value: unknown): ArchiveListItem {
  if (!isRecord(value)) return invalidResponse();
  const id = repositoryId(value.repositoryId);
  const publishedAt = isoDate(value.publishedAt);
  const mode = applicationMode(value.applicationMode);

  return {
    repositoryId: id,
    programId: nonEmptyString(value.programId),
    programName: nonEmptyString(value.programName),
    category: category(value.category),
    applicationMode: mode,
    displayName: nonEmptyString(value.displayName),
    githubUrl: githubUrl(value.githubUrl),
    publishedAt,
    detailUrl: detailUrl(value.detailUrl, id),
    modeLabel: mode === 'PERSONAL' ? '개인' : '팀',
    publishedLabel: new Intl.DateTimeFormat('ko-KR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(new Date(publishedAt)),
  };
}

export function parsePublicArchiveList(value: unknown): ArchiveList {
  if (!isRecord(value) || !Array.isArray(value.items)) return invalidResponse();
  const page = positiveInteger(value.page);
  const pageSize = positiveInteger(value.pageSize);
  const total = nonNegativeInteger(value.total);
  if (value.items.length > pageSize || total < value.items.length) {
    return invalidResponse();
  }

  return { items: value.items.map(listItem), page, pageSize, total };
}

export function parsePublicArchiveDetail(value: unknown): ArchiveDetail {
  if (!isRecord(value)) return invalidResponse();
  const item = listItem({
    ...value,
    detailUrl: `/archive/${repositoryId(value.repositoryId)}`,
  });
  if (!isRecord(value) || !Array.isArray(value.contributors))
    return invalidResponse();
  const repositoryName = nonEmptyString(value.repositoryName);
  const contributors = value.contributors.map((contributor) => {
    if (!isRecord(contributor)) return invalidResponse();
    return {
      userId: nonEmptyString(contributor.userId),
      githubNickname: nonEmptyString(contributor.githubNickname),
      avatarUrl:
        contributor.avatarUrl === null
          ? null
          : nonEmptyString(contributor.avatarUrl),
    };
  });

  return {
    ...(({ detailUrl: _, ...detail }) => detail)(item),
    githubUrl: githubUrl(value.githubUrl, repositoryName),
    repositoryName,
    approvedSubmissionCount: nonNegativeInteger(value.approvedSubmissionCount),
    contributors,
  };
}

export async function loadPublicArchive(input: {
  readonly page: number;
  readonly pageSize: number;
  readonly q: string;
  readonly applicationMode?: ArchiveApplicationMode;
}): Promise<ArchiveList> {
  const query = new URLSearchParams({
    page: String(input.page),
    pageSize: String(input.pageSize),
  });
  if (input.q.trim()) query.set('q', input.q.trim());
  if (input.applicationMode)
    query.set('applicationMode', input.applicationMode);

  try {
    return parsePublicArchiveList(
      await apiClient<unknown>(`repositories/public?${query.toString()}`),
    );
  } catch {
    throw new ArchiveLoadError();
  }
}

export async function loadPublicArchiveDetail(
  id: string,
): Promise<ArchiveDetail> {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new ArchiveNotFoundError();

  try {
    return parsePublicArchiveDetail(
      await apiClient<unknown>(`repositories/${id}/public`),
    );
  } catch (error) {
    if (
      error instanceof ApiError &&
      error.problem.status === 404 &&
      error.problem.code === 'SHW_001'
    ) {
      throw new ArchiveNotFoundError();
    }
    throw new ArchiveLoadError();
  }
}
