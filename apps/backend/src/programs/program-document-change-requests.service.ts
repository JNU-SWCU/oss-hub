import { Inject, Injectable } from '@nestjs/common';
import { ReviewDecision, SubmissionStatus } from '@prisma/client';
import { DomainException } from '../platform/error-code.error';
import {
  MILESTONE_DOCUMENTS_ERROR_CODES,
  MilestoneDocumentsErrorCode,
} from './milestone-documents-error-code.error';
import {
  MilestoneDocumentArchiveRepository,
  type ProgramArchiveReader,
} from './milestone-document-archive.repository';
import {
  type ProgramDocumentChangeRequestCandidate,
  type ProgramDocumentChangeRequestInput,
  type ProgramDocumentChangeRequestPreview,
  type ProgramDocumentChangeRequestScope,
} from './milestone-document-collection-read.repository';
import { MilestoneDocumentsRepository } from './milestone-documents.repository';
import { SubmissionsRepository } from './submissions.repository';
import { createHash } from 'node:crypto';
@Injectable()
export class ProgramDocumentChangeRequestsService {
  constructor(
    private readonly repository: MilestoneDocumentsRepository,
    @Inject(MilestoneDocumentArchiveRepository)
    private readonly programs: ProgramArchiveReader,
    private readonly milestoneDocumentSubmissionRepository: SubmissionsRepository,
  ) {}
  changeRequestTargetStatuses(
    includeFinalDecisions: boolean,
  ): readonly SubmissionStatus[] {
    return includeFinalDecisions
      ? [...OPEN_STATUSES, ...FINAL_STATUSES]
      : OPEN_STATUSES;
  }
  changeRequestTargetsVersion(
    candidates: readonly ProgramDocumentChangeRequestCandidate[],
  ): string {
    const lines = candidates
      .map(
        (candidate) =>
          `${candidate.milestoneDocumentId}:${candidate.teamId}:${
            OPEN_STATUSES.includes(candidate.status) ? 'open' : 'final'
          }`,
      )
      .sort();
    return createHash('sha256').update(lines.join('\n')).digest('hex');
  }
  toProgramDocumentChangeRequestScope(
    scope: ProgramDocumentChangeRequestScope['kind'],
    teamId: string | null | undefined,
  ): ProgramDocumentChangeRequestScope {
    if (scope === 'PROGRAM' && teamId === undefined) return { kind: 'PROGRAM' };
    if (scope === 'TEAM' && typeof teamId === 'string') {
      return { kind: 'TEAM', teamId };
    }
    throw new DomainException(
      MILESTONE_DOCUMENTS_ERROR_CODES[
        MilestoneDocumentsErrorCode.INVALID_REQUEST
      ],
    );
  }
  toProgramDocumentChangeRequestInput(body: {
    readonly scope: ProgramDocumentChangeRequestScope['kind'];
    readonly teamId?: string | null;
    readonly includeFinalDecisions: boolean;
    readonly comment?: string;
    readonly expectedVersion: string;
  }): ProgramDocumentChangeRequestInput {
    const comment = body.comment?.trim() || null;
    return {
      scope: this.toProgramDocumentChangeRequestScope(body.scope, body.teamId),
      includeFinalDecisions: body.includeFinalDecisions,
      comment,
      expectedVersion: body.expectedVersion,
    };
  }
  targetsFromRequest(
    programId: string,
    request: {
      readonly scope: ProgramDocumentChangeRequestScope['kind'];
      readonly teamId?: string | null;
    },
  ): Promise<ProgramDocumentChangeRequestPreview> {
    return this.targets(
      programId,
      this.toProgramDocumentChangeRequestScope(request.scope, request.teamId),
    );
  }
  requestChangesFromRequest(
    reviewerId: string,
    programId: string,
    request: Parameters<
      ProgramDocumentChangeRequestsService['toProgramDocumentChangeRequestInput']
    >[0],
  ): Promise<{
    readonly requestedCount: number;
  }> {
    return this.requestChanges(
      reviewerId,
      programId,
      this.toProgramDocumentChangeRequestInput(request),
    );
  }
  async targets(
    programId: string,
    scope: ProgramDocumentChangeRequestScope,
  ): Promise<ProgramDocumentChangeRequestPreview> {
    const teamIds = await this.teamIdsInScope(programId, scope);
    const candidates = await this.repository.findChangeRequestCandidates(
      programId,
      teamIds,
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
      version: this.changeRequestTargetsVersion(candidates),
    };
  }
  async requestChanges(
    reviewerId: string,
    programId: string,
    input: ProgramDocumentChangeRequestInput,
    now: () => Date = () => new Date(),
  ): Promise<{
    readonly requestedCount: number;
  }> {
    await this.assertProgram(programId);
    const requestedCount = await this.repository.withTransaction(
      async (store) => {
        if (!(await store.lockProgramForReview(programId))) {
          throw this.error(MilestoneDocumentsErrorCode.PROGRAM_NOT_FOUND);
        }
        const documentIds = await store.lockProgramDocumentIds(programId);
        const teamIds = await store.lockApprovedApplicationIds(
          programId,
          input.scope.kind === 'TEAM' ? input.scope.teamId : undefined,
        );
        const candidates = await store.findChangeRequestCandidates({
          documentIds,
          teamIds,
        });
        if (
          this.changeRequestTargetsVersion(candidates) !== input.expectedVersion
        ) {
          throw this.error(MilestoneDocumentsErrorCode.REVIEW_TARGET_CHANGED);
        }
        const statuses = this.changeRequestTargetStatuses(
          input.includeFinalDecisions,
        );
        const targets = candidates.filter((candidate) =>
          statuses.includes(candidate.status),
        );
        for (const target of targets) {
          const submission = await store.findSubmissionForReview(
            target.milestoneDocumentId,
            target.teamId,
          );
          if (submission === null) {
            throw this.error(MilestoneDocumentsErrorCode.REVIEW_TARGET_CHANGED);
          }
          const reviewedAt =
            this.milestoneDocumentSubmissionRepository.nextHistoryCreatedAt(
              now(),
              submission.latestHistoryCreatedAt,
            );
          await store.createReview({
            milestoneDocumentSubmissionId: submission.id,
            submissionHistoryId: submission.submissionHistoryId,
            revision: submission.revision,
            reviewerId,
            decision: ReviewDecision.CHANGES_REQUESTED,
            comment: input.comment,
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
  private async assertProgram(programId: string): Promise<void> {
    if ((await this.programs.findProgram(programId)) === null) {
      throw this.error(MilestoneDocumentsErrorCode.PROGRAM_NOT_FOUND);
    }
  }

  private async teamIdsInScope(
    programId: string,
    scope: ProgramDocumentChangeRequestScope,
  ): Promise<readonly string[]> {
    await this.assertProgram(programId);
    const teams = await this.programs.findApprovedTeams(
      programId,
      scope.kind === 'TEAM' ? scope.teamId : undefined,
    );
    return teams.map((team) => team.teamId);
  }
  private error(code: MilestoneDocumentsErrorCode): DomainException {
    return new DomainException(MILESTONE_DOCUMENTS_ERROR_CODES[code]);
  }
}
const OPEN_STATUSES: readonly SubmissionStatus[] = [
  SubmissionStatus.SUBMITTED,
  SubmissionStatus.CHANGES_REQUESTED,
];
const FINAL_STATUSES: readonly SubmissionStatus[] = [
  SubmissionStatus.APPROVED,
  SubmissionStatus.REJECTED,
];
