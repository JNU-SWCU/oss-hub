import { MilestoneSubmissionType, SubmissionStatus } from '@prisma/client';

export type MilestoneCompletionStatus = SubmissionStatus | 'NOT_SUBMITTED';

export const MILESTONE_NOT_SUBMITTED = 'NOT_SUBMITTED' as const;

export interface MilestoneCompletionInput {
  readonly submissionAxisInUse?: boolean;

  readonly requiredDocumentStatuses: readonly (SubmissionStatus | null)[];

  readonly submissionStatus: SubmissionStatus | null;
}

const STATUS_PRECEDENCE: readonly MilestoneCompletionStatus[] = [
  SubmissionStatus.REJECTED,
  SubmissionStatus.CHANGES_REQUESTED,
  MILESTONE_NOT_SUBMITTED,
  SubmissionStatus.SUBMITTED,
  SubmissionStatus.APPROVED,
];

function isSubmissionAxisInUse(input: MilestoneCompletionInput): boolean {
  if (input.submissionAxisInUse === false) return false;
  return (
    input.requiredDocumentStatuses.length === 0 ||
    input.submissionStatus !== null
  );
}

export function collectAxisStatuses(
  input: MilestoneCompletionInput,
): readonly MilestoneCompletionStatus[] {
  const statuses: MilestoneCompletionStatus[] =
    input.requiredDocumentStatuses.map(
      (status) => status ?? MILESTONE_NOT_SUBMITTED,
    );
  if (isSubmissionAxisInUse(input)) {
    statuses.push(input.submissionStatus ?? MILESTONE_NOT_SUBMITTED);
  }
  return statuses;
}

export function milestoneCompletionStatus(
  input: MilestoneCompletionInput,
): MilestoneCompletionStatus {
  const statuses = collectAxisStatuses(input);
  if (statuses.length === 0) return MILESTONE_NOT_SUBMITTED;
  let worst: MilestoneCompletionStatus = SubmissionStatus.APPROVED;
  let worstRank = STATUS_PRECEDENCE.indexOf(worst);
  for (const status of statuses) {
    const rank = STATUS_PRECEDENCE.indexOf(status);
    if (rank < worstRank) {
      worst = status;
      worstRank = rank;
    }
  }
  return worst;
}

export function isMilestoneComplete(input: MilestoneCompletionInput): boolean {
  return milestoneCompletionStatus(input) === SubmissionStatus.APPROVED;
}

export function requiredMilestonesApproved(
  milestones: readonly {
    readonly id: string;

    readonly submissionType?: MilestoneSubmissionType | null;
    readonly documents: readonly { readonly id: string }[];
  }[],
  submissions: readonly {
    readonly milestoneId: string;
    readonly status: SubmissionStatus;
  }[],
  documentSubmissions: readonly {
    readonly milestoneDocumentId: string;
    readonly status: SubmissionStatus;
  }[],
): boolean {
  const statusByMilestone = new Map(
    submissions.map((submission) => [
      submission.milestoneId,
      submission.status,
    ]),
  );
  const statusByDocument = new Map(
    documentSubmissions.map((submission) => [
      submission.milestoneDocumentId,
      submission.status,
    ]),
  );
  return milestones.every((milestone) =>
    milestone.submissionType === null && milestone.documents.length === 0
      ? true
      : isMilestoneComplete({
          ...(milestone.submissionType === null
            ? { submissionAxisInUse: false }
            : {}),
          requiredDocumentStatuses: milestone.documents.map(
            (document) => statusByDocument.get(document.id) ?? null,
          ),
          submissionStatus: statusByMilestone.get(milestone.id) ?? null,
        }),
  );
}
