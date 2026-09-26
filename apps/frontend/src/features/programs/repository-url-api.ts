import { apiClient } from '@/lib/api-client';

export interface RepositoryUrlState {
  readonly repositoryUrl: string | null;
  readonly canEditRepositoryUrl: boolean;
}

export interface RepositoryUrlInput {
  readonly repositoryUrl: string;
}

export class RepositoryUrlResponseError extends Error {
  constructor() {
    super('저장소 응답을 확인할 수 없습니다. 다시 불러와 주세요.');
    this.name = 'RepositoryUrlResponseError';
  }
}

export function isHttpsGithubOwnerRepoUrl(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/.test(value)
  );
}

export function parseRepositoryUrlState(value: unknown): RepositoryUrlState {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('repositoryUrl' in value) ||
    !('canEditRepositoryUrl' in value) ||
    (value.repositoryUrl !== null &&
      !isHttpsGithubOwnerRepoUrl(value.repositoryUrl)) ||
    typeof value.canEditRepositoryUrl !== 'boolean'
  )
    throw new RepositoryUrlResponseError();
  return {
    repositoryUrl: value.repositoryUrl,
    canEditRepositoryUrl: value.canEditRepositoryUrl,
  };
}

async function patchRepositoryUrl(
  path: string,
  input: RepositoryUrlInput,
): Promise<RepositoryUrlState> {
  return parseRepositoryUrlState(
    await apiClient<unknown>(path, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repositoryUrl: input.repositoryUrl.trim(),
      }),
    }),
  );
}

/** 학생 팀장 — 내 신청의 저장소를 바꾼다. */
export function updateRepositoryUrl(
  programId: string,
  input: RepositoryUrlInput,
): Promise<RepositoryUrlState> {
  return patchRepositoryUrl(
    `programs/${encodeURIComponent(programId)}/applications/me/repository-url`,
    input,
  );
}

/** 교직원 — 팀 상세에서 같은 본문으로 그 팀의 저장소를 바꾼다(#1133). */
export function updateTeamRepositoryUrl(
  programId: string,
  teamId: string,
  input: RepositoryUrlInput,
): Promise<RepositoryUrlState> {
  return patchRepositoryUrl(
    `programs/${encodeURIComponent(programId)}/teams/${encodeURIComponent(teamId)}/repository-url`,
    input,
  );
}
