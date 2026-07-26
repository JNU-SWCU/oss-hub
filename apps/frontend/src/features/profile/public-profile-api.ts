import { ApiError, apiClient } from '@/lib/api-client';
import type {
  PublicProfile,
  PublicProfileApplicationMode,
  PublicProfileCategory,
  PublicProfileRepository,
} from './public-profile-types';

const INVALID_RESPONSE_MESSAGE = '공개 프로필 응답 형식이 올바르지 않습니다';

class PublicProfileResponseError extends Error {
  constructor() {
    super(INVALID_RESPONSE_MESSAGE);
    this.name = 'PublicProfileResponseError';
  }
}

class PublicProfileLoadError extends Error {
  constructor() {
    super('공개 프로필을 불러오지 못했습니다');
    this.name = 'PublicProfileLoadError';
  }
}

export class PublicProfileNotFoundError extends Error {
  constructor() {
    super('공개 프로필을 찾을 수 없습니다');
    this.name = 'PublicProfileNotFoundError';
  }
}

function invalidResponse(): never {
  throw new PublicProfileResponseError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string {
  if (typeof value === 'string' && value.trim().length > 0) return value;
  return invalidResponse();
}

export function isSafePublicProfileUserId(value: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(value);
}

function repositoryId(value: unknown): string {
  const parsed = nonEmptyString(value);
  if (/^[A-Za-z0-9_-]+$/.test(parsed)) return parsed;
  return invalidResponse();
}

function applicationMode(value: unknown): PublicProfileApplicationMode {
  if (value === 'PERSONAL' || value === 'TEAM') return value;
  return invalidResponse();
}

function category(value: unknown): PublicProfileCategory {
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

function githubUrl(value: unknown, repositoryName: string): string {
  const parsed = nonEmptyString(value);
  try {
    const url = new URL(parsed);
    const segments = url.pathname.split('/').filter(Boolean);
    if (
      parsed === `https://github.com/JNU-SWCU/${repositoryName}` &&
      url.origin === 'https://github.com' &&
      url.username === '' &&
      url.password === '' &&
      url.search === '' &&
      url.hash === '' &&
      segments.length === 2 &&
      segments[0] === 'JNU-SWCU' &&
      /^[A-Za-z0-9_.-]+$/.test(repositoryName) &&
      segments[1] === repositoryName
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

function repository(value: unknown): PublicProfileRepository {
  if (!isRecord(value)) return invalidResponse();
  const id = repositoryId(value.repositoryId);
  const mode = applicationMode(value.applicationMode);
  const publishedAt = isoDate(value.publishedAt);
  const repositoryName = nonEmptyString(value.repositoryName);

  return {
    repositoryId: id,
    programId: nonEmptyString(value.programId),
    programName: nonEmptyString(value.programName),
    category: category(value.category),
    applicationMode: mode,
    displayName: nonEmptyString(value.displayName),
    repositoryName,
    githubUrl: githubUrl(value.githubUrl, repositoryName),
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

export function parsePublicProfile(value: unknown): PublicProfile {
  if (!isRecord(value) || !Array.isArray(value.repositories)) {
    return invalidResponse();
  }

  return {
    userId: nonEmptyString(value.userId),
    githubNickname: nonEmptyString(value.githubNickname),
    avatarUrl:
      value.avatarUrl === null ? null : nonEmptyString(value.avatarUrl),
    repositories: value.repositories.map(repository),
  };
}

export async function loadPublicProfile(
  userId: string,
): Promise<PublicProfile> {
  if (!isSafePublicProfileUserId(userId)) {
    throw new PublicProfileNotFoundError();
  }

  try {
    return parsePublicProfile(
      await apiClient<unknown>(`users/${userId}/public-profile`),
    );
  } catch (error) {
    if (
      error instanceof ApiError &&
      error.problem.status === 404 &&
      error.problem.code === 'PRF_001'
    ) {
      throw new PublicProfileNotFoundError();
    }
    throw new PublicProfileLoadError();
  }
}
