import { Inject, Injectable } from '@nestjs/common';
import { DomainException } from '../common/error-code';
import {
  submissionMatrixReviewUrl,
  type SubmissionMatrixQuery,
} from './domain/submission-matrix';
import type {
  MatrixCellResponseDto,
  MatrixRowResponseDto,
  SubmissionMatrixResponseDto,
} from './dto/submission-matrix-response.dto';
import {
  SubmissionMatrixStore,
  type MatrixApplicationRecord,
  type MatrixMilestoneRecord,
  type MatrixSubmissionRecord,
  type SubmissionMatrixRepositoryPort,
} from './submission-matrix.store';
import {
  SUBMISSIONS_ERROR_CODES,
  SubmissionsErrorCode,
} from './submissions-error-code.enum';

@Injectable()
export class SubmissionMatrixService {
  constructor(
    @Inject(SubmissionMatrixStore)
    private readonly repository: SubmissionMatrixRepositoryPort,
  ) {}

  async matrix(
    githubId: bigint,
    programId: string,
    query: SubmissionMatrixQuery,
  ): Promise<SubmissionMatrixResponseDto> {
    if (!(await this.repository.findActiveStaffOrAdmin(githubId))) {
      throw this.error(SubmissionsErrorCode.STAFF_ONLY);
    }
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
    // N+1 금지: 페이지의 application id들로 현재 Submission을 일괄 조회해 메모리 결합한다.
    const submissions = await this.repository.findCurrentSubmissions(
      applications.items.map((application) => application.id),
    );
    const cellIndex = new Map<string, MatrixSubmissionRecord>();
    for (const submission of submissions) {
      cellIndex.set(
        cellKey(submission.applicationId, submission.milestoneId),
        submission,
      );
    }

    return {
      milestones: milestones.map((milestone) => ({
        id: milestone.id,
        name: milestone.name,
        dueAt: milestone.dueAt.toISOString(),
      })),
      rows: applications.items.map((application) =>
        toMatrixRow(programId, application, milestones, cellIndex),
      ),
      page: query.page,
      pageSize: query.pageSize,
      total: applications.total,
    };
  }

  private error(code: SubmissionsErrorCode): DomainException {
    return new DomainException(SUBMISSIONS_ERROR_CODES[code]);
  }
}

function cellKey(applicationId: string, milestoneId: string): string {
  return `${applicationId}::${milestoneId}`;
}

function toMatrixRow(
  programId: string,
  application: MatrixApplicationRecord,
  milestones: readonly MatrixMilestoneRecord[],
  cellIndex: ReadonlyMap<string, MatrixSubmissionRecord>,
): MatrixRowResponseDto {
  return {
    applicationId: application.id,
    applicationMode: application.team ? 'TEAM' : 'PERSONAL',
    displayName: application.team
      ? application.team.name
      : (application.applicant.name ?? application.applicant.nickname),
    githubLogins: application.team
      ? application.team.memberNicknames
      : [application.applicant.nickname],
    cells: milestones.map((milestone) =>
      toMatrixCell(
        programId,
        milestone.id,
        cellIndex.get(cellKey(application.id, milestone.id)) ?? null,
      ),
    ),
  };
}

function toMatrixCell(
  programId: string,
  milestoneId: string,
  submission: MatrixSubmissionRecord | null,
): MatrixCellResponseDto {
  if (!submission) {
    return {
      milestoneId,
      submissionId: null,
      revision: null,
      status: 'NOT_SUBMITTED',
      submittedAt: null,
      reviewUrl: null,
    };
  }
  return {
    milestoneId,
    submissionId: submission.id,
    revision: submission.currentRevision,
    status: submission.status,
    submittedAt: submission.submittedAt?.toISOString() ?? null,
    reviewUrl: submissionMatrixReviewUrl(programId, submission.id),
  };
}
