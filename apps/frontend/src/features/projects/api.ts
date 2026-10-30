import { ApiError, apiClient } from '@/lib/api-client';
import { isRecord } from '@/lib/is-record';
import {
  type ProjectApplicationMode,
  type ProjectTrackType,
  type ProjectContributor,
  type ProjectDetail,
  type ProjectMetrics,
} from './types';

const INVALID_RESPONSE_MESSAGE = '공개 프로젝트 응답 형식이 올바르지 않습니다';

class ProjectResponseError extends Error {
  constructor() {
    super(INVALID_RESPONSE_MESSAGE);
    this.name = 'ProjectResponseError';
  }
}

class ProjectLoadError extends Error {
  constructor() {
    super('공개 프로젝트를 불러오지 못했습니다');
    this.name = 'ProjectLoadError';
  }
}

export class ProjectNotFoundError extends Error {
  constructor() {
    super('공개 프로젝트를 찾을 수 없습니다');
    this.name = 'ProjectNotFoundError';
  }
}

function invalidResponse(): never {
  throw new ProjectResponseError();
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actualKeys = Object.keys(value);
  return (
    actualKeys.length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
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

function projectId(value: unknown): string {
  const parsed = nonEmptyString(value);
  if (/^[A-Za-z0-9_-]+$/.test(parsed)) return parsed;
  return invalidResponse();
}

function applicationMode(value: unknown): ProjectApplicationMode {
  if (value === 'PERSONAL' || value === 'TEAM') return value;
  return invalidResponse();
}

function trackType(value: unknown): ProjectTrackType | null {
  if (value === null) return null;
  if (value === 'CURRICULAR' || value === 'EXTRACURRICULAR') return value;
  return invalidResponse();
}

function rejectLeftoverCategory(record: Record<string, unknown>): void {
  if ('category' in record) invalidResponse();
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
  } catch {}
  return invalidResponse();
}

function githubLogin(value: unknown): string {
  const parsed = nonEmptyString(value);
  if (/^[A-Za-z0-9](?:-?[A-Za-z0-9]){0,38}$/.test(parsed)) return parsed;
  return invalidResponse();
}

const PROJECT_FIELD_KEYS = [
  'projectId',
  'programId',
  'programName',
  'trackType',
  'applicationMode',
  'displayName',
  'repositoryName',
  'githubUrl',
  'publishedAt',
] as const;

const METRICS_KEYS = [
  'commitCount',
  'pullRequestCount',
  'releaseCount',
] as const;

function metrics(value: unknown): ProjectMetrics {
  if (!isRecord(value) || !hasExactKeys(value, METRICS_KEYS)) {
    return invalidResponse();
  }
  return {
    commitCount: nonNegativeInteger(value.commitCount),
    pullRequestCount: nonNegativeInteger(value.pullRequestCount),
    releaseCount: nonNegativeInteger(value.releaseCount),
  };
}

const CONTRIBUTOR_KEYS = [
  'githubLogin',
  'commitCount',
  'pullRequestCount',
  'releaseCount',
] as const;

function contributor(value: unknown): ProjectContributor {
  if (!isRecord(value) || !hasExactKeys(value, CONTRIBUTOR_KEYS)) {
    return invalidResponse();
  }
  const login = githubLogin(value.githubLogin);
  return {
    githubLogin: login,
    commitCount: nonNegativeInteger(value.commitCount),
    pullRequestCount: nonNegativeInteger(value.pullRequestCount),
    releaseCount: nonNegativeInteger(value.releaseCount),
    githubProfileUrl: `https://github.com/${login}`,
  };
}

const DETAIL_KEYS = [...PROJECT_FIELD_KEYS, 'metrics', 'contributors'];

export function parseProjectDetail(value: unknown): ProjectDetail {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, DETAIL_KEYS) ||
    !Array.isArray(value.contributors)
  ) {
    return invalidResponse();
  }
  rejectLeftoverCategory(value);
  const repositoryName = nonEmptyString(value.repositoryName);
  const publishedAt = isoDate(value.publishedAt);

  return {
    projectId: projectId(value.projectId),
    programId: nonEmptyString(value.programId),
    programName: nonEmptyString(value.programName),
    trackType: trackType(value.trackType),
    applicationMode: applicationMode(value.applicationMode),
    displayName: nonEmptyString(value.displayName),
    repositoryName,
    githubUrl: githubUrl(value.githubUrl, repositoryName),
    publishedAt,
    publishedLabel: new Intl.DateTimeFormat('ko-KR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(new Date(publishedAt)),
    metrics: metrics(value.metrics),
    contributors: value.contributors.map(contributor),
  };
}

export async function loadProjectDetail(
  targetProjectId: string,
): Promise<ProjectDetail> {
  if (!/^[A-Za-z0-9_-]+$/.test(targetProjectId)) {
    throw new ProjectNotFoundError();
  }

  try {
    return parseProjectDetail(
      await apiClient<unknown>(`projects/${targetProjectId}`),
    );
  } catch (error) {
    if (
      error instanceof ApiError &&
      error.problem.status === 404 &&
      error.problem.code === 'PPJ_001'
    ) {
      throw new ProjectNotFoundError();
    }
    throw new ProjectLoadError();
  }
}
