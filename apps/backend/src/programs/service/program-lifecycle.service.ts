import { Injectable } from '@nestjs/common';
import { AccountStatus, ProgramLifecycle, Role } from '@prisma/client';
import {
  createProgramLifecycleAuditMetadata,
  PROGRAM_LIFECYCLE_AUDIT_ACTIONS,
} from '../../audit-log/audit-log-metadata';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { DomainException } from '../../common/error-code';
import { PrismaService } from '../../prisma/prisma.service';
import {
  PROGRAM_ERROR_CODES,
  ProgramErrorCode,
} from '../program-error-code.enum';

@Injectable()
export class ProgramLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  async update(
    githubId: bigint,
    programId: string,
    lifecycle: ProgramLifecycle,
  ) {
    const actor = await this.prisma.user.findUnique({
      where: { githubId },
      select: { role: true, accountStatus: true },
    });
    if (
      actor?.accountStatus !== AccountStatus.ACTIVE ||
      (actor.role !== Role.STAFF && actor.role !== Role.ADMIN)
    ) {
      throw new DomainException(
        PROGRAM_ERROR_CODES[ProgramErrorCode.STAFF_APPROVAL_REQUIRED],
      );
    }

    return this.prisma.$transaction(async (transaction) => {
      const program = await transaction.program.findUnique({
        where: { id: programId },
        select: { id: true, name: true, lifecycle: true },
      });
      if (!program) {
        throw new DomainException(
          PROGRAM_ERROR_CODES[ProgramErrorCode.PROGRAM_NOT_FOUND],
        );
      }
      if (program.lifecycle !== lifecycle) {
        await transaction.program.update({
          where: { id: programId },
          data: { lifecycle },
        });
        await this.auditLog.record(
          {
            actorGithubId: githubId,
            action:
              lifecycle === ProgramLifecycle.ARCHIVED
                ? PROGRAM_LIFECYCLE_AUDIT_ACTIONS.PROGRAM_ARCHIVED
                : PROGRAM_LIFECYCLE_AUDIT_ACTIONS.PROGRAM_RESTORED,
            targetType: 'PROGRAM',
            targetId: programId,
            metadata: createProgramLifecycleAuditMetadata({
              programName: program.name,
              before: { lifecycle: program.lifecycle },
              after: { lifecycle },
            }),
          },
          transaction,
        );
      }
      return { id: programId, lifecycle };
    });
  }
}
