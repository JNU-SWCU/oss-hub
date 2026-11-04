import { Injectable } from '@nestjs/common';
import { ReviewDecision, SubmissionStatus } from '@prisma/client';
import { ProgramScheduleService } from './program-schedule.service';

@Injectable()
export class MilestoneDocumentSubmissionWindowService {
  constructor(
    private readonly programScheduleService: ProgramScheduleService,
  ) {}

  isResubmissionAllowedAfter(latestDecision: ReviewDecision | null): boolean {
    if (latestDecision === null) return true;
    switch (latestDecision) {
      case ReviewDecision.APPROVED:
      case ReviewDecision.REJECTED:
        return false;
      case ReviewDecision.CHANGES_REQUESTED:
        return true;
    }
  }

  isChangeRequestResubmissionOpen({
    latestDecision,
    submissionStatus,
  }: {
    readonly latestDecision: ReviewDecision | null;
    readonly submissionStatus: SubmissionStatus | null;
  }): boolean {
    return (
      latestDecision === ReviewDecision.CHANGES_REQUESTED &&
      submissionStatus === SubmissionStatus.CHANGES_REQUESTED
    );
  }

  milestoneDocumentSubmissionBlock({
    dueAt,
    graceDueAt = null,
    now,
    hasSubmission,
    latestDecision,
    submissionStatus,
  }: {
    readonly dueAt: Date;
    readonly graceDueAt?: Date | null;
    readonly now: Date;
    readonly hasSubmission: boolean;
    readonly latestDecision: ReviewDecision | null;

    readonly submissionStatus: SubmissionStatus | null;
  }): MilestoneDocumentSubmissionBlock | null {
    if (
      latestDecision === ReviewDecision.APPROVED ||
      latestDecision === ReviewDecision.REJECTED
    ) {
      return 'RESUBMISSION_NOT_ALLOWED';
    }
    if (!this.programScheduleService.hasProgramDeadlinePassed(dueAt, now))
      return null;
    if (
      this.isChangeRequestResubmissionOpen({ latestDecision, submissionStatus })
    ) {
      return null;
    }

    if (latestDecision === ReviewDecision.CHANGES_REQUESTED && hasSubmission) {
      return 'RESUBMISSION_ALREADY_USED';
    }
    if (
      latestDecision === null &&
      graceDueAt !== null &&
      !this.programScheduleService.hasProgramDeadlinePassed(graceDueAt, now)
    )
      return null;
    return hasSubmission ? 'SUBMISSION_REPLACEMENT_CLOSED' : 'MILESTONE_CLOSED';
  }
}

export type MilestoneDocumentSubmissionBlock =
  | 'MILESTONE_CLOSED'
  | 'SUBMISSION_REPLACEMENT_CLOSED'
  | 'RESUBMISSION_NOT_ALLOWED'
  | 'RESUBMISSION_ALREADY_USED';
