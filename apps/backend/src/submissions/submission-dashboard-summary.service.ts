import { Inject, Injectable } from '@nestjs/common';
import { SubmissionStatus } from '@prisma/client';
import {
  MILESTONE_NOT_SUBMITTED,
  milestoneCompletionStatus,
  type MilestoneCompletionStatus,
} from '../milestone-documents/domain/milestone-completion';
import {
  SubmissionDashboardSummaryRepository,
  type SubmissionDashboardSummaryRepositoryPort,
} from './submission-dashboard-summary.repository';
export interface SubmissionDashboardProgramSummary {
  readonly programId: string;
  readonly approvedApplications: number;
  readonly milestones: number;
  readonly total: number;
  readonly notSubmitted: number;
  readonly submitted: number;
  readonly approved: number;
  readonly changesRequested: number;
  readonly rejected: number;
}

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
export class SubmissionDashboardSummaryService {
  constructor(
    @Inject(SubmissionDashboardSummaryRepository)
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
    }

    const submissionByCell = new Map<string, SubmissionStatus>();
    for (const submission of records.submissions) {
      if (
        !isConsistentCell(
          applicationProgramById,
          milestoneProgramById,
          submission,
        )
      ) {
        continue;
      }

      const cell = cellKey(submission.applicationId, submission.milestoneId);
      if (!submissionByCell.has(cell)) {
        submissionByCell.set(cell, submission.status);
      }
    }

    const requiredDocumentsByMilestone = new Map<string, string[]>();
    for (const document of records.milestoneDocuments) {
      if (
        milestoneProgramById.get(document.milestoneId) !==
        document.milestoneProgramId
      ) {
        continue;
      }
      const documents = requiredDocumentsByMilestone.get(document.milestoneId);
      if (documents) documents.push(document.id);
      else
        requiredDocumentsByMilestone.set(document.milestoneId, [document.id]);
    }

    const documentStatusByCell = new Map<string, SubmissionStatus>();
    for (const submission of records.documentSubmissions) {
      if (
        !isConsistentCell(
          applicationProgramById,
          milestoneProgramById,
          submission,
        )
      ) {
        continue;
      }
      documentStatusByCell.set(
        cellKey(submission.applicationId, submission.milestoneDocumentId),
        submission.status,
      );
    }

    const activeMilestones = records.milestones.filter(
      (milestone) =>
        milestone.submissionType !== null ||
        (requiredDocumentsByMilestone.get(milestone.id)?.length ?? 0) > 0,
    );
    for (const milestone of activeMilestones) {
      const summary = summaryByProgram.get(milestone.programId);
      if (summary) summary.milestones += 1;
    }
    for (const summary of summaries) {
      summary.total = summary.approvedApplications * summary.milestones;
      summary.notSubmitted = summary.total;
    }

    const milestoneIdsByProgram = groupIdsByProgram(activeMilestones);
    const submissionAxisByMilestone = new Map(
      records.milestones.map((milestone) => [
        milestone.id,
        milestone.submissionType !== null,
      ]),
    );
    const applicationIdsByProgram = groupIdsByProgram(records.applications);

    for (const summary of summaries) {
      summary.notSubmitted = 0;
      const milestoneIds = milestoneIdsByProgram.get(summary.programId) ?? [];
      const applicationIds =
        applicationIdsByProgram.get(summary.programId) ?? [];
      for (const applicationId of applicationIds) {
        for (const milestoneId of milestoneIds) {
          const documentIds =
            requiredDocumentsByMilestone.get(milestoneId) ?? [];
          addCellCount(
            summary,
            milestoneCompletionStatus({
              submissionAxisInUse:
                submissionAxisByMilestone.get(milestoneId) ?? true,
              requiredDocumentStatuses: documentIds.map(
                (documentId) =>
                  documentStatusByCell.get(
                    cellKey(applicationId, documentId),
                  ) ?? null,
              ),
              submissionStatus:
                submissionByCell.get(cellKey(applicationId, milestoneId)) ??
                null,
            }),
          );
        }
      }
    }

    return summaries;
  }
}

function cellKey(applicationId: string, otherId: string): string {
  return `${applicationId}::${otherId}`;
}

function groupIdsByProgram(
  rows: readonly { readonly id: string; readonly programId: string }[],
): ReadonlyMap<string, readonly string[]> {
  const byProgram = new Map<string, string[]>();
  for (const row of rows) {
    const ids = byProgram.get(row.programId);
    if (ids) ids.push(row.id);
    else byProgram.set(row.programId, [row.id]);
  }
  return byProgram;
}

function isConsistentCell(
  applicationProgramById: ReadonlyMap<string, string>,
  milestoneProgramById: ReadonlyMap<string, string>,
  row: {
    readonly applicationId: string;
    readonly applicationProgramId: string;
    readonly milestoneId: string;
    readonly milestoneProgramId: string;
  },
): boolean {
  return (
    applicationProgramById.get(row.applicationId) ===
      row.applicationProgramId &&
    milestoneProgramById.get(row.milestoneId) === row.milestoneProgramId &&
    row.applicationProgramId === row.milestoneProgramId
  );
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

function addCellCount(
  summary: MutableSubmissionDashboardProgramSummary,
  status: MilestoneCompletionStatus,
): void {
  switch (status) {
    case MILESTONE_NOT_SUBMITTED:
      summary.notSubmitted += 1;
      return;
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
