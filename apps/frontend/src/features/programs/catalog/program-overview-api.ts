import { apiClient } from '@/lib/api-client';
import type { ProgramOverview } from './program-overview-dto';

class ProgramOverviewResponseError extends Error {
  constructor() {
    super('프로그램 개요 응답 형식이 올바르지 않습니다.');
    this.name = 'ProgramOverviewResponseError';
  }
}

function parseProgramOverview(value: unknown): ProgramOverview {
  if (typeof value !== 'object' || value === null) {
    throw new ProgramOverviewResponseError();
  }
  const record = value as Record<string, unknown>;
  if ('category' in record) {
    throw new ProgramOverviewResponseError();
  }
  return record as unknown as ProgramOverview;
}

export async function getProgramOverview(
  programId: string,
  operationsView = false,
): Promise<ProgramOverview> {
  return parseProgramOverview(
    await apiClient<unknown>(
      `programs/${encodeURIComponent(programId)}/overview${operationsView ? '?view=operations' : ''}`,
    ),
  );
}
