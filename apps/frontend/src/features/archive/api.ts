import { ApiError, apiClient } from '@/lib/api-client';
import {
  ARCHIVE_CATEGORY_LABELS,
  type ArchiveApplicationMode,
  type ArchiveCategory,
  type ArchiveContributor,
  type ArchiveDetail,
  type ArchiveListItem,
  type ArchiveMetrics,
  type ArchivePage,
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

function positiveInteger(value: unknown): number {
  const parsed = nonNegativeInteger(value);
  if (parsed > 0) return parsed;
  return invalidResponse();
}

function projectId(value: unknown): string {
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
    typeof value === 'string' &&
    Object.hasOwn(ARCHIVE_CATEGORY_LABELS, value)
  ) {
    return value as ArchiveCategory;
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

// GitHub username rule: alphanumeric or single hyphens, no leading/trailing
// hyphen, max 39 chars — validated before building an external profile link.
function githubLogin(value: unknown): string {
  const parsed = nonEmptyString(value);
  if (/^[A-Za-z0-9](?:-?[A-Za-z0-9]){0,38}$/.test(parsed)) return parsed;
  return invalidResponse();
}

const PROJECT_FIELD_KEYS = [
  'projectId',
  'programId',
  'programName',
  'category',
  'applicationMode',
  'displayName',
  'repositoryName',
  'githubUrl',
  'publishedAt',
] as const;

type ArchiveProjectFields = Omit<
  ArchiveListItem,
  'detailUrl' | 'modeLabel' | 'categoryLabel' | 'publishedLabel'
>;

function projectFields(value: Record<string, unknown>): ArchiveProjectFields {
  const id = projectId(value.projectId);
  const mode = applicationMode(value.applicationMode);
  const repositoryName = nonEmptyString(value.repositoryName);

  return {
    projectId: id,
    programId: nonEmptyString(value.programId),
    programName: nonEmptyString(value.programName),
    category: category(value.category),
    applicationMode: mode,
    displayName: nonEmptyString(value.displayName),
    repositoryName,
    githubUrl: githubUrl(value.githubUrl, repositoryName),
    publishedAt: isoDate(value.publishedAt),
  };
}

function withLabels(
  fields: ArchiveProjectFields,
): Omit<ArchiveListItem, 'detailUrl'> {
  return {
    ...fields,
    modeLabel: fields.applicationMode === 'PERSONAL' ? '개인' : '팀',
    categoryLabel: ARCHIVE_CATEGORY_LABELS[fields.category],
    publishedLabel: new Intl.DateTimeFormat('ko-KR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(new Date(fields.publishedAt)),
  };
}

function listItem(value: unknown): ArchiveListItem {
  if (!isRecord(value) || !hasExactKeys(value, PROJECT_FIELD_KEYS)) {
    return invalidResponse();
  }
  const fields = projectFields(value);
  return { ...withLabels(fields), detailUrl: `/archive/${fields.projectId}` };
}

const METRICS_KEYS = [
  'commitCount',
  'pullRequestCount',
  'releaseCount',
] as const;

function metrics(value: unknown): ArchiveMetrics {
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

function contributor(value: unknown): ArchiveContributor {
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

const PAGE_KEYS = ['items', 'pageSize', 'nextPageId'] as const;

export function parseArchivePage(value: unknown): ArchivePage {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, PAGE_KEYS) ||
    !Array.isArray(value.items)
  ) {
    return invalidResponse();
  }
  const pageSize = positiveInteger(value.pageSize);
  if (value.items.length > pageSize) return invalidResponse();
  const nextPageId =
    value.nextPageId === null ? null : nonEmptyString(value.nextPageId);

  return { items: value.items.map(listItem), pageSize, nextPageId };
}

const DETAIL_KEYS = [...PROJECT_FIELD_KEYS, 'metrics', 'contributors'];

export function parseArchiveDetail(value: unknown): ArchiveDetail {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, DETAIL_KEYS) ||
    !Array.isArray(value.contributors)
  ) {
    return invalidResponse();
  }
  const fields = projectFields(value);

  return {
    ...withLabels(fields),
    metrics: metrics(value.metrics),
    contributors: value.contributors.map(contributor),
  };
}

export async function loadArchivePage(input: {
  readonly pageId: string | null;
  readonly pageSize: number;
}): Promise<ArchivePage> {
  const query = new URLSearchParams({ pageSize: String(input.pageSize) });
  if (input.pageId !== null) query.set('pageId', input.pageId);

  try {
    return parseArchivePage(
      await apiClient<unknown>(`projects?${query.toString()}`),
    );
  } catch {
    throw new ArchiveLoadError();
  }
}

export async function loadArchiveDetail(
  targetProjectId: string,
): Promise<ArchiveDetail> {
  if (!/^[A-Za-z0-9_-]+$/.test(targetProjectId)) {
    throw new ArchiveNotFoundError();
  }

  try {
    return parseArchiveDetail(
      await apiClient<unknown>(`projects/${targetProjectId}`),
    );
  } catch (error) {
    if (
      error instanceof ApiError &&
      error.problem.status === 404 &&
      error.problem.code === 'PPJ_001'
    ) {
      throw new ArchiveNotFoundError();
    }
    throw new ArchiveLoadError();
  }
}
