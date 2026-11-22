import { MilestoneCompletionService } from './submissions.service';
import { Inject, Injectable } from '@nestjs/common';
import { DomainException } from '../platform/error-code.error';
import {
  SubmissionMatrixRepository,
  type MatrixApplicationRecord,
  type MatrixCellStatus,
  type MatrixMilestoneRecord,
  type MatrixStatusCounts,
  type MatrixSubmissionRecord,
  type SubmissionMatrixRepositoryPort,
  type SubmissionMatrixFilter,
  type MatrixApplicationMode,
  SubmissionDashboardSummaryRepository,
  type SubmissionDashboardProgramSummary,
  type SubmissionDashboardSummaryRepositoryPort,
} from './submissions.repository';
import {
  SUBMISSIONS_ERROR_CODES,
  SubmissionsErrorCode,
} from './submissions.error';
import { type DocumentDeliveryStatus } from './requirements.repository';
import { RequirementCollectionService } from './requirement-archive.service';
export interface SubmissionMatrixQuery extends SubmissionMatrixFilter {
  readonly page: number;
  readonly pageSize: number;
}

export type SubmissionMatrixRequest = Partial<SubmissionMatrixQuery>;

const MATRIX_DEFAULT_PAGE_SIZE = 20;

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
  readonly leaderName: string | null;
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
  readonly statusCounts: MatrixStatusCounts;
}

@Injectable()
export class SubmissionMatrixService {
  constructor(
    @Inject(SubmissionMatrixRepository)
    private readonly repository: SubmissionMatrixRepositoryPort,
    private readonly requirementCollectionService: RequirementCollectionService,
    private readonly milestoneCompletionService: MilestoneCompletionService,
  ) {}

  matrixQueryFromRequest(
    request: SubmissionMatrixRequest,
  ): SubmissionMatrixQuery {
    return {
      q: request.q?.trim() ?? '',
      applicationMode: request.applicationMode ?? null,
      status: request.status,
      sort: request.sort,
      direction: request.direction,
      page: request.page ?? 1,
      pageSize: request.pageSize ?? MATRIX_DEFAULT_PAGE_SIZE,
    };
  }

  async matrix(
    programId: string,
    request: SubmissionMatrixRequest,
  ): Promise<SubmissionMatrixResult> {
    const { page, pageSize, ...filter } = this.matrixQueryFromRequest(request);
    if (!(await this.repository.programExists(programId))) {
      throw this.error(SubmissionsErrorCode.PROGRAM_NOT_FOUND);
    }

    const [milestones, applications] = await Promise.all([
      this.repository.findMilestones(programId),
      this.repository.findApprovedApplications(
        programId,
        filter,
        (page - 1) * pageSize,
        pageSize,
      ),
    ]);

    const teamIds = applications.items.map((application) => application.id);
    const [submissions, firstSubmissions, changeRequests] = await Promise.all([
      this.repository.findCurrentSubmissions(teamIds, programId),
      this.repository.findDocumentFirstSubmissions(
        teamIds,
        milestones.flatMap((milestone) => milestone.requiredDocumentIds),
      ),
      this.repository.findDocumentChangeRequests(teamIds, programId),
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
        cellKey(submission.teamId, submission.requirementId),
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
      page,
      pageSize,
      total: applications.total,
      statusCounts: applications.statusCounts,
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
      leaderName: application.leaderName,
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
          this.requirementCollectionService.documentDeliveryStatus({
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
    submissions.map((submission) => [submission.requirementId, submission]),
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
@Injectable()
export class SubmissionDashboardSummaryService {
  constructor(
    @Inject(SubmissionDashboardSummaryRepository)
    private readonly repository: SubmissionDashboardSummaryRepositoryPort,
  ) {}
  async listByProgram(
    programIds: readonly string[],
  ): Promise<readonly SubmissionDashboardProgramSummary[]> {
    return this.repository.summarizePrograms(programIds);
  }
}
