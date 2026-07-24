import { apiClient } from '@/lib/api-client';
import { parseMilestoneTimelineResponse } from './parser';
import type { MilestoneTimeline } from './types';

export type LoadMilestoneTimelineParams = {
  readonly programId: string;
};

export async function loadMilestoneTimeline({
  programId,
}: LoadMilestoneTimelineParams): Promise<MilestoneTimeline> {
  const payload = await apiClient<unknown>(
    `programs/${encodeURIComponent(programId)}/submissions/me`,
  );
  return parseMilestoneTimelineResponse(payload, programId);
}

export { parseMilestoneTimelineResponse };
