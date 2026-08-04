import { Inject, Injectable } from '@nestjs/common';
import { SubmissionStatus } from '@prisma/client';
import {
  SubmissionDashboardSummaryStore,
  type SubmissionDashboardSummaryRepositoryPort,
} from './submission-dashboard-summary.store';
import type {
  SubmissionDashboardProgramSummary,
  SubmissionDashboardSummaryPort,
} from './submission-dashboard-summary.port';

interface MutableSubmissionDashboardProgramSummary {
  programId: string;
  approvedApplications: number;
  milestones: number;
  total: number;
  notSubmitted: number;
  submitted: number;
  approved: number;
  changesRequested: number;
  rejected: number;
}

class UnexpectedSubmissionStatusError extends Error {
  override readonly name = 'UnexpectedSubmissionStatusError';
}

@Injectable()
export class SubmissionDashboardSummaryService implements SubmissionDashboardSummaryPort {
  constructor(
    @Inject(SubmissionDashboardSummaryStore)
    private readonly repository: SubmissionDashboardSummaryRepositoryPort,
  ) {}

  async listByProgram(
    programIds: readonly string[],
  ): Promise<readonly SubmissionDashboardProgramSummary[]> {
    const summaries = programIds.map(emptySummary);
    const summaryByProgram = new Map(
      summaries.map((summary) => [summary.programId, summary]),
    );
    const records = await this.repository.listRecords(programIds);
    const applicationProgramById = new Map<string, string>();
    const milestoneProgramById = new Map<string, string>();

    for (const application of records.applications) {
      applicationProgramById.set(application.id, application.programId);
      const summary = summaryByProgram.get(application.programId);
      if (summary) summary.approvedApplications += 1;
    }
    for (const milestone of records.milestones) {
      milestoneProgramById.set(milestone.id, milestone.programId);
      const summary = summaryByProgram.get(milestone.programId);
      if (summary) summary.milestones += 1;
    }
    for (const summary of summaries) {
      summary.total = summary.approvedApplications * summary.milestones;
      summary.notSubmitted = summary.total;
    }

    const countedCells = new Set<string>();
    for (const submission of records.submissions) {
      const applicationProgram = applicationProgramById.get(
        submission.applicationId,
      );
      const milestoneProgram = milestoneProgramById.get(submission.milestoneId);
      const cell = `${submission.applicationId}::${submission.milestoneId}`;
      const summary = summaryByProgram.get(submission.applicationProgramId);
      if (
        applicationProgram !== submission.applicationProgramId ||
        milestoneProgram !== submission.milestoneProgramId ||
        submission.applicationProgramId !== submission.milestoneProgramId ||
        countedCells.has(cell) ||
        !summary
      ) {
        continue;
      }
      countedCells.add(cell);
      summary.notSubmitted -= 1;
      addSubmissionCount(summary, submission.status);
    }

    return summaries;
  }
}

function emptySummary(
  programId: string,
): MutableSubmissionDashboardProgramSummary {
  return {
    programId,
    approvedApplications: 0,
    milestones: 0,
    total: 0,
    notSubmitted: 0,
    submitted: 0,
    approved: 0,
    changesRequested: 0,
    rejected: 0,
  };
}

function addSubmissionCount(
  summary: MutableSubmissionDashboardProgramSummary,
  status: SubmissionStatus,
): void {
  switch (status) {
    case SubmissionStatus.SUBMITTED:
      summary.submitted += 1;
      return;
    case SubmissionStatus.APPROVED:
      summary.approved += 1;
      return;
    case SubmissionStatus.CHANGES_REQUESTED:
      summary.changesRequested += 1;
      return;
    case SubmissionStatus.REJECTED:
      summary.rejected += 1;
      return;
  }
  const unreachable: never = status;
  throw new UnexpectedSubmissionStatusError(unreachable);
}
