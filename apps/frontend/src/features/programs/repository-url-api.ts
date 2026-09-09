import { apiClient } from '@/lib/api-client';

export interface RepositoryUrlState {
  readonly repositoryUrl: string | null;
  readonly canEditRepositoryUrl: boolean;
}

export interface RepositoryUrlInput {
  readonly repositoryUrl: string;
  readonly reason: string;
}

export class RepositoryUrlResponseError extends Error {
  constructor() {
    super('저장소 응답을 확인할 수 없습니다. 다시 불러와 주세요.');
    this.name = 'RepositoryUrlResponseError';
  }
}

export function parseRepositoryUrlState(value: unknown): RepositoryUrlState {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('repositoryUrl' in value) ||
    !('canEditRepositoryUrl' in value) ||
    (value.repositoryUrl !== null && typeof value.repositoryUrl !== 'string') ||
    typeof value.canEditRepositoryUrl !== 'boolean'
  )
    throw new RepositoryUrlResponseError();
  return {
    repositoryUrl: value.repositoryUrl,
    canEditRepositoryUrl: value.canEditRepositoryUrl,
  };
}

export async function getRepositoryUrl(
  programId: string,
): Promise<RepositoryUrlState> {
  return parseRepositoryUrlState(
    await apiClient<unknown>(
      `programs/${encodeURIComponent(programId)}/applications/me/repository-url`,
    ),
  );
}

export async function updateRepositoryUrl(
  programId: string,
  input: RepositoryUrlInput,
): Promise<RepositoryUrlState> {
  return parseRepositoryUrlState(
    await apiClient<unknown>(
      `programs/${encodeURIComponent(programId)}/applications/me/repository-url`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repositoryUrl: input.repositoryUrl.trim(),
          reason: input.reason.trim(),
        }),
      },
    ),
  );
}
