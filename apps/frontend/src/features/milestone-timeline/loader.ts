import { parseMilestoneTimelineResponse } from './parser';
import type { MilestoneTimeline } from './types';

export type LoadMilestoneTimelineParams = {
  readonly programId: string;
};

const LOAD_ERROR_MESSAGE = '마일스톤 타임라인을 불러올 수 없습니다';

class MilestoneTimelineLoadError extends Error {
  constructor() {
    super(LOAD_ERROR_MESSAGE);
    this.name = 'MilestoneTimelineLoadError';
  }
}

export async function loadMilestoneTimeline(
  _params: LoadMilestoneTimelineParams,
): Promise<MilestoneTimeline> {
  throw new MilestoneTimelineLoadError();
}

export { parseMilestoneTimelineResponse };
