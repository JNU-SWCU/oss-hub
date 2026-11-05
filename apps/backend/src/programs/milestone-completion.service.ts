import { SubmissionStatus } from '@prisma/client';
import {
  SubmissionCompletionTargetRow,
  SubmissionCompletionProjections,
} from './submission-completion.config';
import {
  MilestoneCompletionStatus,
  MILESTONE_NOT_SUBMITTED,
  MilestoneCompletionInput,
} from './milestone-completion.config';
import { Injectable } from '@nestjs/common';
@Injectable()
export class MilestoneCompletionService {
  collectAxisStatuses(
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
  milestoneCompletionStatus(
    input: MilestoneCompletionInput,
  ): MilestoneCompletionStatus {
    const statuses = this.collectAxisStatuses(input);
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
  isMilestoneComplete(input: MilestoneCompletionInput): boolean {
    return this.milestoneCompletionStatus(input) === SubmissionStatus.APPROVED;
  }
  requiredMilestonesApproved(
    milestones: readonly {
      readonly id: string;
      readonly documents: readonly {
        readonly id: string;
      }[];
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
    const statusByDocument = new Map(
      documentSubmissions.map((submission) => [
        submission.milestoneDocumentId,
        submission.status,
      ]),
    );
    return milestones.every(
      (milestone) =>
        milestone.documents.length === 0 ||
        this.isMilestoneComplete({
          submissionAxisInUse: false,
          requiredDocumentStatuses: milestone.documents.map(
            (document) => statusByDocument.get(document.id) ?? null,
          ),
          submissionStatus: null,
        }),
    );
  }
  projectSubmissionCompletionTargets(
    targetRows: readonly SubmissionCompletionTargetRow[],
  ): SubmissionCompletionProjections {
    const submissions: {
      milestoneId: string;
      status: SubmissionStatus;
    }[] = [];
    const documentSubmissions: {
      milestoneDocumentId: string;
      status: SubmissionStatus;
    }[] = [];
    for (const targetRow of targetRows) {
      documentSubmissions.push({
        milestoneDocumentId: targetRow.milestoneDocument.id,
        status: targetRow.status,
      });
    }
    return { submissions, documentSubmissions };
  }
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
