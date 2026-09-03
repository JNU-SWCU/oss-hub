import { ApiError, apiClient } from '@/lib/api-client';
import type {
  PublicProfile,
  PublicProfileApplicationMode,
  PublicProfileTrackType,
  PublicProfileMetrics,
  PublicProfileProject,
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

function nonNegativeInteger(value: unknown): number {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return value;
  }
  return invalidResponse();
}

export function isSafePublicProfileUserId(value: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(value);
}

function projectId(value: unknown): string {
  const parsed = nonEmptyString(value);
  if (/^[A-Za-z0-9_-]+$/.test(parsed)) return parsed;
  return invalidResponse();
}

function applicationMode(value: unknown): PublicProfileApplicationMode {
  if (value === 'PERSONAL' || value === 'TEAM') return value;
  return invalidResponse();
}

function trackType(value: unknown): PublicProfileTrackType | null {
  if (value === null) return null;
  if (value === 'CURRICULAR' || value === 'EXTRACURRICULAR') return value;
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

function nullableIsoDate(value: unknown): string | null {
  if (value === null) return null;
  return isoDate(value);
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

function metrics(value: unknown): PublicProfileMetrics {
  if (!isRecord(value)) return invalidResponse();
  return {
    commitCount: nonNegativeInteger(value.commitCount),
    pullRequestCount: nonNegativeInteger(value.pullRequestCount),
    releaseCount: nonNegativeInteger(value.releaseCount),
  };
}

function nullableMetrics(value: unknown): PublicProfileMetrics | null {
  if (value === null) return null;
  return metrics(value);
}

function observed(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  return invalidResponse();
}

function project(value: unknown): PublicProfileProject {
  if (!isRecord(value)) return invalidResponse();
  if ('category' in value) return invalidResponse();
  const id = projectId(value.projectId);
  const mode = applicationMode(value.applicationMode);
  const publishedAt = isoDate(value.publishedAt);
  const repositoryName = nonEmptyString(value.repositoryName);
  const isObserved = observed(value.observed);
  const hasCollectedData = observed(value.hasCollectedData);
  const dataAsOf = nullableIsoDate(value.dataAsOf);
  const projectMetrics = nullableMetrics(value.metrics);

  // observed/dataAsOf/metrics는 서로의 존재를 함께 증명한다 — 미관측이면 나머지 둘도
  // 반드시 null이어야 하고, 관측이면 반드시 값이 있어야 한다("관측했지만 0"과 "미관측"의
  // 구분이 서버-클라이언트 경계에서 깨지지 않도록 exact-key 파서가 이 관계까지 검증한다).
  if (
    isObserved === (dataAsOf === null) ||
    isObserved === (projectMetrics === null)
  ) {
    return invalidResponse();
  }
  // #893 — hasCollectedData가 true면 반드시 observed도 true여야 한다(수집이 끝났는데
  // 미관측일 수는 없다). observed가 false인데 hasCollectedData가 true인 조합은 계약 위반이다.
  if (hasCollectedData && !isObserved) {
    return invalidResponse();
  }

  return {
    projectId: id,
    programId: nonEmptyString(value.programId),
    programName: nonEmptyString(value.programName),
    trackType: trackType(value.trackType),
    applicationMode: mode,
    displayName: nonEmptyString(value.displayName),
    repositoryName,
    githubUrl: githubUrl(value.githubUrl, repositoryName),
    publishedAt,
    detailUrl: `/archive/${id}`,
    modeLabel: mode === 'PERSONAL' ? '개인' : '팀',
    publishedLabel: new Intl.DateTimeFormat('ko-KR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(new Date(publishedAt)),
    observed: isObserved,
    hasCollectedData,
    dataAsOf,
    metrics: projectMetrics,
  };
}

export function parsePublicProfile(value: unknown): PublicProfile {
  if (!isRecord(value) || !Array.isArray(value.projects)) {
    return invalidResponse();
  }

  return {
    userId: nonEmptyString(value.userId),
    githubNickname: nonEmptyString(value.githubNickname),
    avatarUrl:
      value.avatarUrl === null ? null : nonEmptyString(value.avatarUrl),
    projects: value.projects.map(project),
    observedTotals: metrics(value.observedTotals),
  };
}

export async function loadPublicProfile(
  userId: string,
): Promise<PublicProfile> {
  if (!isSafePublicProfileUserId(userId)) {
    throw new PublicProfileNotFoundError();
  }

  try {
    // 백엔드 공개 read 경로는 `users/:userId/public-profile`이다(#551) — `users/me/profile`
    // (세션 보호)과 마지막 세그먼트를 다르게 둬서 모듈 등록 순서와 무관하게 매칭된다.
    return parsePublicProfile(
      await apiClient<unknown>(`users/${userId}/public-profile`),
    );
  } catch (error) {
    if (
      error instanceof ApiError &&
      error.problem.status === 404 &&
      error.problem.code === 'PPJ_002'
    ) {
      throw new PublicProfileNotFoundError();
    }
    throw new PublicProfileLoadError();
  }
}
