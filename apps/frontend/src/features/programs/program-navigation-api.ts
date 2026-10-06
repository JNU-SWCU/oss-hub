import { apiClient } from '@/lib/api-client';

interface PublicProgramNavigationResponse {
  readonly milestones: readonly {
    readonly id: string;
    readonly name: string;
    readonly submissionType: 'FILE' | 'TEXT' | null;
    readonly submissionItemCount: number;
  }[];
}

export interface ProgramNavigationMilestone {
  readonly milestoneId: string;
  readonly title: string;

  readonly submissionEnabled: boolean;
}

export async function getProgramNavigationMilestones(
  programId: string,
): Promise<readonly ProgramNavigationMilestone[]> {
  const program = await apiClient<PublicProgramNavigationResponse>(
    `programs/${encodeURIComponent(programId)}`,
  );
  return program.milestones.map((milestone) => ({
    milestoneId: milestone.id,
    title: milestone.name,
    submissionEnabled: milestone.submissionType !== null,
  }));
}
