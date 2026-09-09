import { Inject, Injectable } from '@nestjs/common';
import { DomainException } from '../common/error-code';
import { documentDeliveryStatus } from './document-delivery-status';
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
  SubmissionMatrixRepository,
  type MatrixApplicationRecord,
  type MatrixMilestoneRecord,
  type MatrixSubmissionRecord,
  type SubmissionMatrixRepositoryPort,
} from './submission-matrix.repository';
import {
  SUBMISSIONS_ERROR_CODES,
  SubmissionsErrorCode,
} from './submissions-error-code.enum';

@Injectable()
export class SubmissionMatrixService {
  constructor(
    @Inject(SubmissionMatrixRepository)
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
    const applicationIds = applications.items.map(
      (application) => application.id,
    );
    const [submissions, firstSubmissions] = await Promise.all([
      this.repository.findCurrentSubmissions(applicationIds),
      this.repository.findDocumentFirstSubmissions(
        applicationIds,
        milestones.flatMap((milestone) => milestone.requiredDocumentIds),
      ),
    ]);
    const cellIndex = new Map<string, MatrixSubmissionRecord>();
    for (const submission of submissions) {
      cellIndex.set(
        cellKey(submission.applicationId, submission.milestoneId),
        submission,
      );
    }
    const firstSubmissionIndex = new Map(
      firstSubmissions.map((submission) => [
        cellKey(submission.applicationId, submission.milestoneDocumentId),
        submission.firstSubmittedAt,
      ]),
    );

    return {
      milestones: milestones.map((milestone) => ({
        id: milestone.id,
        name: milestone.name,
        dueAt: milestone.dueAt.toISOString(),
      })),
      rows: applications.items.map((application) =>
        toMatrixRow(programId, application, milestones, {
          reviews: cellIndex,
          firstSubmissions: firstSubmissionIndex,
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
}

function cellKey(applicationId: string, milestoneId: string): string {
  return `${applicationId}::${milestoneId}`;
}

/**
 * 개인 참여는 멤버가 1명뿐인 팀이다(D5·D6). 팀 유무가 아니라 인원으로 가른다.
 */
function isSoloTeam(application: MatrixApplicationRecord): boolean {
  const team = application.team;
  return team === null || team.memberNicknames.length <= 1;
}

function toMatrixRow(
  programId: string,
  application: MatrixApplicationRecord,
  milestones: readonly MatrixMilestoneRecord[],
  index: {
    readonly reviews: ReadonlyMap<string, MatrixSubmissionRecord>;
    readonly firstSubmissions: ReadonlyMap<string, Date>;
  },
): MatrixRowResponseDto {
  return {
    applicationId: application.id,
    // 모든 신청이 Team을 갖게 되면서(D5) 팀 유무로는 개인 참여를 가려낼 수 없다.
    // 멤버가 1명뿐이면 개인 참여로 읽고 사람 이름을 보여 준다 — 예전 표시와 같다.
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
        programId,
        milestone.id,
        index.reviews.get(cellKey(application.id, milestone.id)) ?? null,
      ),
      deliveryStatus: documentDeliveryStatus({
        dueAt: milestone.dueAt,
        requiredFirstSubmissions: milestone.requiredDocumentIds.map(
          (documentId) =>
            index.firstSubmissions.get(cellKey(application.id, documentId)) ??
            null,
        ),
      }),
    })),
  };
}

function toMatrixCell(
  programId: string,
  milestoneId: string,
  submission: MatrixSubmissionRecord | null,
): Omit<MatrixCellResponseDto, 'deliveryStatus'> {
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
