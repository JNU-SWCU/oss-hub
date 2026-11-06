import { MilestoneCompletionService } from './submissions.service';
import { Inject, Injectable } from '@nestjs/common';
import { DomainException } from '../platform/error-code.error';
import {
  SubmissionMatrixRepository,
  type MatrixApplicationRecord,
  type MatrixMilestoneRecord,
  type MatrixSubmissionRecord,
  type SubmissionMatrixRepositoryPort,
  SubmissionMatrixFilter,
  MatrixApplicationMode,
  SubmissionDashboardSummaryRepository,
  type SubmissionDashboardSummaryRepositoryPort,
} from './submissions.repository';
import {
  SUBMISSIONS_ERROR_CODES,
  SubmissionsErrorCode,
} from './submissions-error-code.error';
import { SubmissionStatus } from '@prisma/client';
import { type DocumentDeliveryStatus } from './requirements.repository';
import { MilestoneDocumentCollectionService } from './requirement-archive.service';
import { UnexpectedSubmissionStatusError } from './submission-dashboard-summary.error';
import {
  MILESTONE_NOT_SUBMITTED,
  type MilestoneCompletionStatus,
} from './milestone-completion.config';
export interface SubmissionMatrixQuery extends SubmissionMatrixFilter {
  readonly page: number;
  readonly pageSize: number;
}

export interface SubmissionMatrixRequest {
  readonly q?: string;
  readonly applicationMode?: MatrixApplicationMode | null;
  readonly page?: number;
  readonly pageSize?: number;
}

const MATRIX_DEFAULT_PAGE_SIZE = 20;

export type MatrixCellStatus = SubmissionStatus | 'NOT_SUBMITTED';

interface MatrixCellResult {
  readonly milestoneId: string;
  readonly submissionId: string | null;
  readonly revision: number | null;
  readonly status: MatrixCellStatus;
  readonly submittedAt: Date | null;
  readonly deliveryStatus: DocumentDeliveryStatus;
  readonly changesRequestedCount: number;
}

export interface MatrixRowResult {
  readonly teamId: string;
  readonly applicationMode: MatrixApplicationMode;
  readonly displayName: string;
  readonly githubLogins: readonly string[];
  readonly cells: readonly MatrixCellResult[];
}

export interface SubmissionMatrixResult {
  readonly milestones: readonly {
    readonly id: string;
    readonly name: string;
    readonly dueAt: Date;
  }[];
  readonly rows: readonly MatrixRowResult[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}

@Injectable()
export class SubmissionMatrixService {
  constructor(
    @Inject(SubmissionMatrixRepository)
    private readonly repository: SubmissionMatrixRepositoryPort,
    private readonly milestoneDocumentCollectionService: MilestoneDocumentCollectionService,
    private readonly milestoneCompletionService: MilestoneCompletionService,
  ) {}

  matrixQueryFromRequest(
    request: SubmissionMatrixRequest,
  ): SubmissionMatrixQuery {
    return {
      q: request.q?.trim() ?? '',
      applicationMode: request.applicationMode ?? null,
      page: request.page ?? 1,
      pageSize: request.pageSize ?? MATRIX_DEFAULT_PAGE_SIZE,
    };
  }

  async matrix(
    programId: string,
    request: SubmissionMatrixRequest,
  ): Promise<SubmissionMatrixResult> {
    const query = this.matrixQueryFromRequest(request);
    if (!(await this.repository.programExists(programId))) {
      throw this.error(SubmissionsErrorCode.PROGRAM_NOT_FOUND);
    }

    const [milestones, applications] = await Promise.all([
      this.repository.findMilestones(programId),
      this.repository.findApprovedApplications(
        programId,
        { q: query.q, applicationMode: query.applicationMode },
        (query.page - 1) * query.pageSize,
        query.pageSize,
      ),
    ]);

    const teamIds = applications.items.map((application) => application.id);
    const [submissions, firstSubmissions, changeRequests] = await Promise.all([
      this.repository.findCurrentSubmissions(teamIds),
      this.repository.findDocumentFirstSubmissions(
        teamIds,
        milestones.flatMap((milestone) => milestone.requiredDocumentIds),
      ),
      this.repository.findDocumentChangeRequests(teamIds),
    ]);
    const cellIndex = new Map<string, MatrixSubmissionRecord[]>();
    for (const submission of submissions) {
      const key = cellKey(submission.teamId, submission.milestoneId);
      const group = cellIndex.get(key);
      if (group) group.push(submission);
      else cellIndex.set(key, [submission]);
    }
    const changeRequestCounts = new Map<string, number>();
    for (const request of changeRequests) {
      const key = cellKey(request.teamId, request.milestoneId);
      changeRequestCounts.set(key, (changeRequestCounts.get(key) ?? 0) + 1);
    }
    const firstSubmissionIndex = new Map(
      firstSubmissions.map((submission) => [
        cellKey(submission.teamId, submission.milestoneDocumentId),
        submission.firstSubmittedAt,
      ]),
    );

    return {
      milestones: milestones.map((milestone) => ({
        id: milestone.id,
        name: milestone.name,
        dueAt: milestone.dueAt,
      })),
      rows: applications.items.map((application) =>
        this.toMatrixRow(application, milestones, {
          reviews: cellIndex,
          firstSubmissions: firstSubmissionIndex,
          changeRequestCounts,
        }),
      ),
      page: query.page,
      pageSize: query.pageSize,
      total: applications.total,
    };
  }

  private error(code: SubmissionsErrorCode): DomainException {
    return new DomainException(SUBMISSIONS_ERROR_CODES[code]);
  }

  private toMatrixRow(
    application: MatrixApplicationRecord,
    milestones: readonly MatrixMilestoneRecord[],
    index: {
      readonly reviews: ReadonlyMap<string, readonly MatrixSubmissionRecord[]>;
      readonly firstSubmissions: ReadonlyMap<string, Date>;
      readonly changeRequestCounts: ReadonlyMap<string, number>;
    },
  ): MatrixRowResult {
    return {
      teamId: application.id,

      applicationMode: isSoloTeam(application) ? 'PERSONAL' : 'TEAM',
      displayName: isSoloTeam(application)
        ? (application.applicant.name ?? application.applicant.nickname)
        : (application.team?.name ??
          application.applicant.name ??
          application.applicant.nickname),
      githubLogins: application.team
        ? application.team.memberNicknames
        : [application.applicant.nickname],
      cells: milestones.map((milestone) => ({
        ...toMatrixCell(
          milestone,
          index.reviews.get(cellKey(application.id, milestone.id)) ?? [],
          this.milestoneCompletionService,
        ),
        deliveryStatus:
          this.milestoneDocumentCollectionService.documentDeliveryStatus({
            dueAt: milestone.dueAt,
            requiredFirstSubmissions: milestone.requiredDocumentIds.map(
              (documentId) =>
                index.firstSubmissions.get(
                  cellKey(application.id, documentId),
                ) ?? null,
            ),
          }),
        changesRequestedCount:
          index.changeRequestCounts.get(
            cellKey(application.id, milestone.id),
          ) ?? 0,
      })),
    };
  }
}

function cellKey(teamId: string, milestoneId: string): string {
  return `${teamId}::${milestoneId}`;
}

function isSoloTeam(application: MatrixApplicationRecord): boolean {
  const team = application.team;
  return team === null || team.memberNicknames.length <= 1;
}

function toMatrixCell(
  milestone: MatrixMilestoneRecord,
  submissions: readonly MatrixSubmissionRecord[],
  completion: MilestoneCompletionService,
): Omit<MatrixCellResult, 'deliveryStatus' | 'changesRequestedCount'> {
  const byRequirement = new Map(
    submissions.map((submission) => [
      submission.milestoneDocumentId,
      submission,
    ]),
  );
  const status = completion.milestoneCompletionStatus({
    submissionAxisInUse: false,
    submissionStatus: null,
    requiredDocumentStatuses: milestone.requiredDocumentIds.map(
      (id) => byRequirement.get(id)?.status ?? null,
    ),
  });
  const submission =
    milestone.requiredDocumentIds.length === 1
      ? byRequirement.get(milestone.requiredDocumentIds[0] ?? '')
      : undefined;
  return {
    milestoneId: milestone.id,
    submissionId: submission?.id ?? null,
    revision: submission?.currentRevision ?? null,
    status,
    submittedAt: submission?.submittedAt ?? null,
  };
}
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
@Injectable()
export class SubmissionDashboardSummaryService {
  constructor(
    @Inject(SubmissionDashboardSummaryRepository)
    private readonly repository: SubmissionDashboardSummaryRepositoryPort,
    private readonly milestoneCompletionService: MilestoneCompletionService,
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

      const cell = cellKey(submission.teamId, submission.milestoneId);
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
        cellKey(submission.teamId, submission.milestoneDocumentId),
        submission.status,
      );
    }
    const activeMilestones = records.milestones.filter(
      (milestone) =>
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
    const teamIdsByProgram = groupIdsByProgram(records.applications);
    for (const summary of summaries) {
      summary.notSubmitted = 0;
      const milestoneIds = milestoneIdsByProgram.get(summary.programId) ?? [];
      const teamIds = teamIdsByProgram.get(summary.programId) ?? [];
      for (const teamId of teamIds) {
        for (const milestoneId of milestoneIds) {
          const documentIds =
            requiredDocumentsByMilestone.get(milestoneId) ?? [];
          addCellCount(
            summary,
            this.milestoneCompletionService.milestoneCompletionStatus({
              submissionAxisInUse: false,
              requiredDocumentStatuses: documentIds.map(
                (documentId) =>
                  documentStatusByCell.get(cellKey(teamId, documentId)) ?? null,
              ),
              submissionStatus:
                submissionByCell.get(cellKey(teamId, milestoneId)) ?? null,
            }),
          );
        }
      }
    }
    return summaries;
  }
}
function groupIdsByProgram(
  rows: readonly {
    readonly id: string;
    readonly programId: string;
  }[],
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
    readonly teamId: string;
    readonly applicationProgramId: string;
    readonly milestoneId: string;
    readonly milestoneProgramId: string;
  },
): boolean {
  return (
    applicationProgramById.get(row.teamId) === row.applicationProgramId &&
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
