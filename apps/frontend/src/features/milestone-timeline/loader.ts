import { apiClient } from '@/lib/api-client';
import { parseMilestoneTimelineResponse } from './parser';
import { isSafePathSegment } from './path-segment';
import type { MilestoneTimeline } from './types';

export type LoadMilestoneTimelineParams = {
  readonly programId: string;
};

class MilestoneTimelinePathError extends Error {
  constructor() {
    super('마일스톤 타임라인 경로가 올바르지 않습니다');
    this.name = 'MilestoneTimelinePathError';
  }
}

export async function loadMilestoneTimeline({
  programId,
}: LoadMilestoneTimelineParams): Promise<MilestoneTimeline> {
  if (!isSafePathSegment(programId)) {
    throw new MilestoneTimelinePathError();
  }
  const payload = await apiClient<unknown>(
    `programs/${encodeURIComponent(programId)}/submissions/me`,
  );
  return parseMilestoneTimelineResponse(payload, programId);
}

export { parseMilestoneTimelineResponse };
