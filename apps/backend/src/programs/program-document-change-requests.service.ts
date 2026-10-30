import { Inject, Injectable } from '@nestjs/common';
import { ReviewDecision, SubmissionStatus } from '@prisma/client';
import { DomainException } from '../platform/error-code.error';
import { UsersAuthorityService } from '../users/authority.service';
import {
  MILESTONE_DOCUMENTS_ERROR_CODES,
  MilestoneDocumentsErrorCode,
} from './milestone-documents-error-code.error';
import {
  changeRequestTargetStatuses,
  changeRequestTargetsVersion,
  type ProgramDocumentChangeRequestInput,
  type ProgramDocumentChangeRequestPreview,
  type ProgramDocumentChangeRequestScope,
} from './program-document-change-request.policy';
import {
  MilestoneDocumentArchiveRepository,
  type ProgramArchiveReader,
} from './milestone-document-archive.repository';
import { nextMilestoneDocumentHistoryCreatedAt } from './milestone-document-history-query.repository';
import { MilestoneDocumentsRepository } from './milestone-documents.repository';

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
  ): Promise<ProgramDocumentChangeRequestPreview> {
    await this.assertStaff(sessionGithubId);
    const applicationIds = await this.applicationIdsInScope(programId, scope);
    const candidates = await this.repository.findChangeRequestCandidates(
      programId,
      applicationIds,
    );
    const count = (status: SubmissionStatus) =>
      candidates.filter((candidate) => candidate.status === status).length;
    return {
      counts: {
        [SubmissionStatus.SUBMITTED]: count(SubmissionStatus.SUBMITTED),
        [SubmissionStatus.CHANGES_REQUESTED]: count(
          SubmissionStatus.CHANGES_REQUESTED,
        ),
        [SubmissionStatus.APPROVED]: count(SubmissionStatus.APPROVED),
        [SubmissionStatus.REJECTED]: count(SubmissionStatus.REJECTED),
      },
      version: changeRequestTargetsVersion(candidates),
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
    await this.assertProgram(programId);

    const requestedCount = await this.repository.withTransaction(
      async (store) => {
        const documentIds = await store.lockProgramDocumentIds(programId);
        const applicationIds = await store.lockApprovedApplicationIds(
          programId,
          input.scope.kind === 'TEAM' ? input.scope.teamId : undefined,
        );
        const candidates = await store.findChangeRequestCandidates({
          documentIds,
          applicationIds,
        });
        if (changeRequestTargetsVersion(candidates) !== input.expectedVersion) {
          throw this.error(MilestoneDocumentsErrorCode.REVIEW_TARGET_CHANGED);
        }
        const statuses = changeRequestTargetStatuses(
          input.includeFinalDecisions,
        );
        const targets = candidates.filter((candidate) =>
          statuses.includes(candidate.status),
        );

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

  private async assertProgram(programId: string): Promise<void> {
    if ((await this.programs.findProgram(programId)) === null) {
      throw this.error(MilestoneDocumentsErrorCode.PROGRAM_NOT_FOUND);
    }
  }

  private async applicationIdsInScope(
    programId: string,
    scope: ProgramDocumentChangeRequestScope,
  ): Promise<readonly string[]> {
    await this.assertProgram(programId);
    const teams = await this.programs.findApprovedTeams(
      programId,
      scope.kind === 'TEAM' ? scope.teamId : undefined,
    );
    return teams.map((team) => team.applicationId);
  }

  private error(code: MilestoneDocumentsErrorCode): DomainException {
    return new DomainException(MILESTONE_DOCUMENTS_ERROR_CODES[code]);
  }
}
