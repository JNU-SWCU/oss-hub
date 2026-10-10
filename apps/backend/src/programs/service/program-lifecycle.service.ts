import { Injectable } from '@nestjs/common';
import { AccountStatus } from '@prisma/client';
import {
  createProgramDeletionAuditMetadata,
  PROGRAM_DELETION_AUDIT_ACTIONS,
} from '../../audit-log/domain/audit-log-metadata';
import { AuditLogService } from '../../audit-log/service/audit-log.service';
import { DomainException } from '../../common/error-code';
import { isSerializationFailure } from '../../common/repository/prisma-serialization-retry';
import {
  sameProgramDeletionScopeCountValues,
  sameProgramDeletionScopeCounts,
  type ProgramDeletionScopeCounts,
} from '../domain/program-deletion-scope';
import {
  PROGRAM_ERROR_CODES,
  ProgramErrorCode,
} from '../program-error-code.enum';
import type { ProgramPurgeResult } from '../domain/program-purge';
import {
  isForeignKeyConflict,
  ProgramLifecycleRepository,
} from '../repository/program-lifecycle.repository';

@Injectable()
export class ProgramLifecycleService {
  constructor(
    private readonly repository: ProgramLifecycleRepository,
    private readonly auditLog: AuditLogService,
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
          metadata: createProgramDeletionAuditMetadata({
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
            metadata: createProgramDeletionAuditMetadata({
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
      const serializationFailure = isSerializationFailure(error);
      const foreignKeyConflict = isForeignKeyConflict(error);
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

class ProgramPurgeDeletedScopeMismatchError extends Error {
  constructor() {
    super('Program purge deleted counts differ from its confirmed scope.');
    this.name = 'ProgramPurgeDeletedScopeMismatchError';
  }
}
