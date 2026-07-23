import { parseMilestoneTimelineResponse } from './parser';
import type {
  MilestoneChecklistResponse,
  MilestoneTimeline,
  MilestoneTimelineFixture,
  SubmittedStatus,
  SubmissionType,
} from './types';

export type LoadMilestoneTimelineParams = {
  readonly programId: string;
  readonly fixture: MilestoneTimelineFixture | null;
  readonly attempt: number;
  readonly now?: Date;
};

const LOAD_ERROR_MESSAGE = '마일스톤 타임라인을 불러오지 못했습니다';

class MilestoneTimelineLoadError extends Error {
  constructor() {
    super(LOAD_ERROR_MESSAGE);
    this.name = 'MilestoneTimelineLoadError';
  }
}

function submitted(status: SubmittedStatus, revision: number) {
  return {
    id: `submission-${status.toLowerCase()}`,
    status,
    currentRevision: revision,
    lastReviewedAt: status === 'SUBMITTED' ? null : '2026-07-23T12:00:00+09:00',
    reviewComment:
      status === 'CHANGES_REQUESTED' ? '보완 후 다시 제출해 주세요.' : null,
    canResubmit: status === 'CHANGES_REQUESTED',
  } as const;
}

function item(
  milestoneId: string,
  name: string,
  dueAt: string,
  submissionType: SubmissionType,
  status: SubmittedStatus | null,
) {
  return {
    milestoneId,
    name,
    dueAt,
    submissionType,
    submission: status === null ? null : submitted(status, 1),
  } as const;
}

function syntheticResponse(empty: boolean): MilestoneChecklistResponse {
  return {
    applicationId: 'application-fixture',
    applicationMode: 'TEAM',
    items: empty
      ? []
      : [
          item(
            'text',
            '아이디어 요약',
            '2026-07-24T23:59:59+09:00',
            'TEXT',
            'SUBMITTED',
          ),
          item(
            'file',
            '기획서',
            '2026-07-30T23:59:59+09:00',
            'FILE',
            'CHANGES_REQUESTED',
          ),
          item(
            'release',
            '릴리스 제출',
            '2026-08-03T23:59:59+09:00',
            'REPOSITORY_RELEASE',
            'APPROVED',
          ),
          item(
            'rejected',
            '최종 보고서',
            '2026-08-10T23:59:59+09:00',
            'TEXT',
            'REJECTED',
          ),
          item(
            'missing',
            '성과 공유',
            '2026-08-20T23:59:59+09:00',
            'FILE',
            null,
          ),
        ],
  };
}

export async function loadMilestoneTimeline({
  programId,
  fixture,
  attempt,
  now = new Date(),
}: LoadMilestoneTimelineParams): Promise<MilestoneTimeline> {
  if (fixture === 'error' && attempt === 0) {
    throw new MilestoneTimelineLoadError();
  }
  return parseMilestoneTimelineResponse(
    syntheticResponse(fixture === 'empty'),
    programId,
    now,
  );
}

export { parseMilestoneTimelineResponse };
