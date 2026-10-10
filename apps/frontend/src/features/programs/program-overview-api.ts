import { apiClient } from '@/lib/api-client';
import type { ViewerRole } from './types';

interface ProgramOverviewMilestoneDocument {
  readonly milestoneId: string;
  readonly title: string;
  readonly completed: number;
  readonly total: number;
}

export interface ProgramOverview {
  readonly programId: string;
  readonly name: string;
  readonly trackType: string | null;
  readonly lifecycle: string;
  readonly milestoneCount: number;
  readonly boardPostCount: number;
  readonly participantCount: number;
  readonly teamCount: number;
  readonly connectedRepositoryCount: number;
  readonly viewerRole: ViewerRole;

  readonly viewerDocumentsCompleted: number | null;

  readonly viewerDocumentsTotal: number | null;

  readonly fullySubmittedParticipantCount: number | null;

  readonly remainingMilestones: readonly {
    readonly label: string;
    readonly dueAt: string;
  }[];

  readonly milestoneDocuments: readonly ProgramOverviewMilestoneDocument[];
}

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
): Promise<ProgramOverview> {
  return parseProgramOverview(
    await apiClient<unknown>(
      `programs/${encodeURIComponent(programId)}/overview`,
    ),
  );
}
