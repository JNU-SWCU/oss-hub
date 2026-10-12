import { Inject, Injectable } from '@nestjs/common';
import { ReviewDecision, SubmissionStatus } from '@prisma/client';
import { DomainException } from '../../common/error-code';
import { UsersAuthorityService } from '../../users/service/authority.service';
import {
  MILESTONE_DOCUMENTS_ERROR_CODES,
  MilestoneDocumentsErrorCode,
} from '../domain/milestone-documents-error-code.enum';
import {
  changeRequestTargetStatuses,
  type ProgramDocumentChangeRequestInput,
  type ProgramDocumentChangeRequestScope,
  type ProgramDocumentChangeRequestTargetCounts,
} from '../domain/program-document-change-request';
import {
  MilestoneDocumentArchiveRepository,
  type ProgramArchiveReader,
} from '../repository/milestone-document-archive.repository';
import { nextMilestoneDocumentHistoryCreatedAt } from '../repository/milestone-document-history';
import { MilestoneDocumentsRepository } from '../repository/milestone-documents.repository';

@Injectable()
export class ProgramDocumentChangeRequestsService {
  constructor(
    private readonly repository: MilestoneDocumentsRepository,
    @Inject(MilestoneDocumentArchiveRepository)
    private readonly programs: ProgramArchiveReader,
    @Inject(UsersAuthorityService)
    private readonly authority: Pick<
      UsersAuthorityService,
      'assertActiveStaff'
    >,
  ) {}

  async targets(
    sessionGithubId: bigint,
    programId: string,
    scope: ProgramDocumentChangeRequestScope,
  ): Promise<ProgramDocumentChangeRequestTargetCounts> {
    await this.assertStaff(sessionGithubId);
    const applicationIds = await this.applicationIdsInScope(programId, scope);
    const counts = await this.repository.countChangeRequestTargets(
      programId,
      applicationIds,
    );
    return {
      [SubmissionStatus.SUBMITTED]: counts.get(SubmissionStatus.SUBMITTED) ?? 0,
      [SubmissionStatus.CHANGES_REQUESTED]:
        counts.get(SubmissionStatus.CHANGES_REQUESTED) ?? 0,
      [SubmissionStatus.APPROVED]: counts.get(SubmissionStatus.APPROVED) ?? 0,
      [SubmissionStatus.REJECTED]: counts.get(SubmissionStatus.REJECTED) ?? 0,
    };
  }

  async requestChanges(
    sessionGithubId: bigint,
    programId: string,
    input: ProgramDocumentChangeRequestInput,
    now: () => Date = () => new Date(),
  ): Promise<{ readonly requestedCount: number }> {
    const { actorId: reviewerId } = await this.assertStaff(sessionGithubId);
    if (input.resubmissionDueAt.getTime() <= now().getTime()) {
      throw this.error(
        MilestoneDocumentsErrorCode.RESUBMISSION_DUE_AT_NOT_FUTURE,
      );
    }
    const applicationIds = await this.applicationIdsInScope(
      programId,
      input.scope,
    );

    const requestedCount = await this.repository.withTransaction(
      async (store) => {
        const documentIds = await store.lockProgramDocumentIds(programId);
        const targets = await store.findChangeRequestTargets({
          documentIds,
          applicationIds,
          statuses: changeRequestTargetStatuses(input.includeFinalDecisions),
        });
        if (targets.length !== input.expectedCount) {
          throw this.error(MilestoneDocumentsErrorCode.REVIEW_TARGET_CHANGED);
        }

        for (const target of targets) {
          const submission = await store.findSubmissionForReview(
            target.milestoneDocumentId,
            target.applicationId,
          );
          if (submission === null) {
            throw this.error(MilestoneDocumentsErrorCode.REVIEW_TARGET_CHANGED);
          }
          const reviewedAt = nextMilestoneDocumentHistoryCreatedAt(
            now(),
            submission.latestHistoryCreatedAt,
          );
          if (input.resubmissionDueAt.getTime() <= reviewedAt.getTime()) {
            throw this.error(
              MilestoneDocumentsErrorCode.RESUBMISSION_DUE_AT_NOT_FUTURE,
            );
          }
          await store.createReview({
            milestoneDocumentSubmissionId: submission.id,
            submissionHistoryId: submission.submissionHistoryId,
            revision: submission.revision,
            reviewerId,
            decision: ReviewDecision.CHANGES_REQUESTED,
            comment: input.comment,
            resubmissionDueAt: input.resubmissionDueAt,
            reviewedAt,
          });
          await store.updateSubmissionStatus(
            submission.id,
            SubmissionStatus.CHANGES_REQUESTED,
          );
        }
        return targets.length;
      },
    );

    return { requestedCount };
  }

  private assertStaff(sessionGithubId: bigint) {
    return this.authority.assertActiveStaff(sessionGithubId, () =>
      this.error(MilestoneDocumentsErrorCode.STAFF_ONLY),
    );
  }

  private async applicationIdsInScope(
    programId: string,
    scope: ProgramDocumentChangeRequestScope,
  ): Promise<readonly string[]> {
    const program = await this.programs.findProgram(programId);
    if (program === null) {
      throw this.error(MilestoneDocumentsErrorCode.PROGRAM_NOT_FOUND);
    }
    const teams = await this.programs.findApprovedTeams(
      programId,
      scope.kind === 'TEAM' ? scope.teamId : undefined,
    );
    if (scope.kind === 'TEAM' && teams.length === 0) {
      throw this.error(
        MilestoneDocumentsErrorCode.CHANGE_REQUEST_TEAM_NOT_FOUND,
      );
    }
    return teams.map((team) => team.applicationId);
  }

  private error(code: MilestoneDocumentsErrorCode): DomainException {
    return new DomainException(MILESTONE_DOCUMENTS_ERROR_CODES[code]);
  }
}
