import { Injectable } from '@nestjs/common';
import { AccountStatus } from '@prisma/client';
import { AuditLogService } from '../platform/audit-log.service';
import { PROGRAM_DELETION_AUDIT_ACTIONS } from '../platform/audit-log-metadata.config';
import { DomainException } from '../platform/error-code.error';
import { PrismaSerializationRetryRepository } from '../platform/prisma-serialization-retry.repository';
import {
  PROGRAM_ERROR_CODES,
  ProgramErrorCode,
} from './program-error-code.error';
import {
  ProgramLifecycleRepository,
  ProgramPurgeDeletedCounts,
} from './program-lifecycle.repository';
import { ProgramPurgeDeletedScopeMismatchError } from './program-lifecycle.error';
import { type ProgramDeletionScopeCounts } from './program-deletion-scope.repository';
import { AuditLogMetadataService } from '../platform/audit-log-metadata.service';

export type ProgramPurgeResult = {
  readonly id: string;
  readonly deleted: true;
  readonly deletedCounts: ProgramPurgeDeletedCounts;
};

@Injectable()
export class ProgramLifecycleService {
  constructor(
    private readonly repository: ProgramLifecycleRepository,
    private readonly auditLog: AuditLogService,
    private readonly auditLogMetadataService: AuditLogMetadataService,
  ) {}

  async delete(
    githubId: bigint,
    programId: string,
  ): Promise<{ readonly id: string; readonly deleted: true }> {
    const actor = await this.repository.findDeletionActor(githubId);
    if (
      actor?.accountStatus !== AccountStatus.ACTIVE ||
      (!actor.hasStaffAccess && !actor.hasAdminAccess)
    ) {
      throw new DomainException(
        PROGRAM_ERROR_CODES[ProgramErrorCode.PROGRAM_DELETE_FORBIDDEN],
      );
    }

    return this.repository.withDeleteTransaction(async (transaction) => {
      const program = await this.repository.findProgramForDeletion(
        transaction,
        programId,
      );
      if (!program) {
        throw new DomainException(
          PROGRAM_ERROR_CODES[ProgramErrorCode.PROGRAM_NOT_FOUND],
        );
      }
      const blockingCounts = await this.repository.countDeletionBlockers(
        transaction,
        programId,
      );
      if (
        blockingCounts.applications > 0 ||
        blockingCounts.teams > 0 ||
        blockingCounts.submissions > 0 ||
        blockingCounts.boardPosts > 0
      ) {
        throw new DomainException(
          PROGRAM_ERROR_CODES[ProgramErrorCode.PROGRAM_DELETE_BLOCKED],
          { blockingCounts },
        );
      }

      const orphanRepositoryCount =
        await this.repository.countOrphanRepositories(transaction, programId);
      if (orphanRepositoryCount > 0) {
        throw new DomainException(
          PROGRAM_ERROR_CODES[ProgramErrorCode.PROGRAM_DELETE_BLOCKED],
          { blockingCounts },
        );
      }

      await this.repository.deleteAuthoringArtifacts(transaction, programId);
      await this.repository.deleteMilestoneTree(transaction, programId);
      await this.repository.deleteProgramCover(transaction, programId);
      await this.repository.deleteProgram(transaction, programId);

      await this.auditLog.record(
        {
          actorGithubId: githubId,
          action: PROGRAM_DELETION_AUDIT_ACTIONS.PROGRAM_DELETED,
          targetType: 'PROGRAM',
          targetId: programId,
          metadata:
            this.auditLogMetadataService.createProgramDeletionAuditMetadata({
              programName: program.name,
              lifecycle: program.lifecycle,
              blockingCounts,
            }),
        },
        transaction,
      );

      return { id: programId, deleted: true as const };
    });
  }

  async purge(
    githubId: bigint,
    programId: string,
    expectedScope: ProgramDeletionScopeCounts,
  ): Promise<ProgramPurgeResult> {
    const actor = await this.repository.findDeletionActor(githubId);
    if (
      actor?.accountStatus !== AccountStatus.ACTIVE ||
      (!actor.hasStaffAccess && !actor.hasAdminAccess)
    ) {
      throw new DomainException(
        PROGRAM_ERROR_CODES[ProgramErrorCode.PROGRAM_DELETE_FORBIDDEN],
      );
    }

    try {
      return await this.repository.withPurgeTransaction(async (transaction) => {
        const program = await this.repository.findProgramForDeletion(
          transaction,
          programId,
        );
        if (!program) {
          throw new DomainException(
            PROGRAM_ERROR_CODES[ProgramErrorCode.PROGRAM_NOT_FOUND],
          );
        }

        const currentScopeCounts =
          await this.repository.readScopeCountsInTransaction(
            transaction,
            programId,
          );
        if (
          !sameProgramDeletionScopeCounts(expectedScope, currentScopeCounts)
        ) {
          throw new DomainException(
            PROGRAM_ERROR_CODES[ProgramErrorCode.PROGRAM_PURGE_SCOPE_CHANGED],
            { currentScopeCounts },
          );
        }

        const deletedCounts = await this.repository.purgeProgramTree(
          transaction,
          programId,
        );
        if (
          !sameProgramDeletionScopeCountValues(currentScopeCounts, {
            applications: deletedCounts.applications,
            teams: deletedCounts.teams,
            boardPosts: deletedCounts.boardPosts,
            submissions: deletedCounts.submissions,
            submissionEvents:
              deletedCounts.submissionFiles +
              deletedCounts.milestoneDocumentSubmissionHistories +
              deletedCounts.milestoneDocumentReviewHistories,
          })
        ) {
          throw new ProgramPurgeDeletedScopeMismatchError();
        }
        await this.repository.deleteProgram(transaction, programId);

        await this.auditLog.record(
          {
            actorGithubId: githubId,
            action: PROGRAM_DELETION_AUDIT_ACTIONS.PROGRAM_DELETED,
            targetType: 'PROGRAM',
            targetId: programId,
            metadata:
              this.auditLogMetadataService.createProgramDeletionAuditMetadata({
                programName: program.name,
                lifecycle: program.lifecycle,
                blockingCounts: {
                  applications: 0,
                  teams: 0,
                  submissions: 0,
                  boardPosts: 0,
                },
              }),
          },
          transaction,
        );

        return { id: programId, deleted: true as const, deletedCounts };
      });
    } catch (error) {
      const serializationFailure =
        PrismaSerializationRetryRepository.isSerializationFailure(error);
      const foreignKeyConflict =
        ProgramLifecycleRepository.isForeignKeyConflict(error);
      const deletedScopeMismatch =
        error instanceof ProgramPurgeDeletedScopeMismatchError;
      if (
        !serializationFailure &&
        !foreignKeyConflict &&
        !deletedScopeMismatch
      ) {
        throw error;
      }

      const currentScopeCounts =
        await this.repository.readScopeCounts(programId);
      if (
        serializationFailure ||
        deletedScopeMismatch ||
        !sameProgramDeletionScopeCounts(expectedScope, currentScopeCounts)
      ) {
        throw new DomainException(
          PROGRAM_ERROR_CODES[ProgramErrorCode.PROGRAM_PURGE_SCOPE_CHANGED],
          { currentScopeCounts },
        );
      }
      throw error;
    }
  }
}

function sameProgramDeletionScopeCounts(
  left: ProgramDeletionScopeCounts,
  right: ProgramDeletionScopeCounts,
): boolean {
  return (
    left.applications === right.applications &&
    left.teams === right.teams &&
    left.boardPosts === right.boardPosts &&
    left.submissions === right.submissions &&
    left.submissionEvents === right.submissionEvents &&
    left.scopeFingerprint === right.scopeFingerprint
  );
}

function sameProgramDeletionScopeCountValues(
  left: ProgramDeletionScopeCounts,
  right: Omit<ProgramDeletionScopeCounts, 'scopeFingerprint'>,
): boolean {
  return (
    left.applications === right.applications &&
    left.teams === right.teams &&
    left.boardPosts === right.boardPosts &&
    left.submissions === right.submissions &&
    left.submissionEvents === right.submissionEvents
  );
}
