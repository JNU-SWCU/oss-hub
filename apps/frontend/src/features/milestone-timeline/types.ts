export const MILESTONE_TIMELINE_FIXTURES = ['empty', 'error'] as const;
export type MilestoneTimelineFixture =
  (typeof MILESTONE_TIMELINE_FIXTURES)[number];

export type ApplicationMode = 'PERSONAL' | 'TEAM';
export type SubmissionType = 'TEXT' | 'FILE' | 'REPOSITORY_RELEASE';
export type SubmittedStatus =
  'SUBMITTED' | 'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED';
export type TimelineStatus = SubmittedStatus | 'NOT_SUBMITTED';

export type ChecklistSubmission = {
  readonly id: string;
  readonly status: SubmittedStatus;
  readonly currentRevision: number;
  readonly lastReviewedAt: string | null;
  readonly reviewComment: string | null;
  readonly canResubmit: boolean;
};

export type MilestoneChecklistResponse = {
  readonly applicationId: string;
  readonly applicationMode: ApplicationMode;
  readonly items: readonly {
    readonly milestoneId: string;
    readonly name: string;
    readonly dueAt: string;
    readonly submissionType: SubmissionType;
    readonly submission: ChecklistSubmission | null;
  }[];
};

export type MilestoneTimelineItem = {
  readonly milestoneId: string;
  readonly name: string;
  readonly dueAt: string;
  readonly dueLabel: string;
  readonly dDayLabel: string;
  readonly submissionType: SubmissionType;
  readonly submissionGuide: string;
  readonly submission: ChecklistSubmission | null;
  readonly status: TimelineStatus;
  readonly statusLabel: string;
  readonly submitHref: string;
};

export type MilestoneTimeline = {
  readonly applicationId: string;
  readonly applicationMode: ApplicationMode;
  readonly items: readonly MilestoneTimelineItem[];
};

export type MilestoneTimelineState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error' }
  | { readonly kind: 'ready'; readonly timeline: MilestoneTimeline };
