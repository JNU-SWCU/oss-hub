import { apiClient } from '@/lib/api-client';
import type {
  PublicProgramNavigationResponse,
  ProgramNavigationMilestone,
} from './program-navigation-dto';

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
