import { Injectable } from '@nestjs/common';
import { type AccountStatus, type Prisma, type Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuditLogListRequestDto } from './dto/audit-log-query.dto';

const auditLogSelect = {
  id: true,
  actor: { select: { nickname: true } },
  action: true,
  targetType: true,
  targetId: true,
  occurredAt: true,
} satisfies Prisma.AuditLogSelect;

type PrismaAuditLog = Prisma.AuditLogGetPayload<{
  select: typeof auditLogSelect;
}>;

export type AuditLogTransactionWriter = Pick<
  Prisma.TransactionClient,
  'auditLog'
>;

export interface AuditLogActor {
  readonly id: string;
  readonly role: Role | null;
  readonly accountStatus: AccountStatus;
}

export interface AuditLogRecord {
  readonly id: string;
  readonly actor: string;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly occurredAt: Date;
}

export interface AuditLogRecordInput {
  readonly actorGithubId: bigint;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string;
}

export interface AuditLogRepositoryPort {
  findActorByGithubId(githubId: bigint): Promise<AuditLogActor | null>;
  list(query: AuditLogListRequestDto): Promise<readonly AuditLogRecord[]>;
  record(
    input: AuditLogRecordInput,
    writer?: AuditLogTransactionWriter,
  ): Promise<AuditLogRecord>;
}

@Injectable()
export class AuditLogRepository implements AuditLogRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  findActorByGithubId(githubId: bigint): Promise<AuditLogActor | null> {
    return this.prisma.user.findUnique({
      where: { githubId },
      select: { id: true, role: true, accountStatus: true },
    });
  }

  async list(
    query: AuditLogListRequestDto,
  ): Promise<readonly AuditLogRecord[]> {
    const logs = await this.prisma.auditLog.findMany({
      where: {
        actor: query.actor
          ? { nickname: { contains: query.actor, mode: 'insensitive' } }
          : undefined,
        action: query.action || undefined,
        occurredAt:
          query.from || query.to
            ? {
                gte: query.from
                  ? new Date(`${query.from}T00:00:00.000+09:00`)
                  : undefined,
                lte: query.to
                  ? new Date(`${query.to}T23:59:59.999+09:00`)
                  : undefined,
              }
            : undefined,
      },
      select: auditLogSelect,
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    });
    return logs.map(toAuditLogRecord);
  }

  async record(
    input: AuditLogRecordInput,
    writer: AuditLogTransactionWriter = this.prisma,
  ): Promise<AuditLogRecord> {
    const log = await writer.auditLog.create({
      data: {
        actor: { connect: { githubId: input.actorGithubId } },
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        metadata: {},
      },
      select: auditLogSelect,
    });
    return toAuditLogRecord(log);
  }
}

function toAuditLogRecord(log: PrismaAuditLog): AuditLogRecord {
  return {
    id: log.id,
    actor: log.actor.nickname,
    action: log.action,
    targetType: log.targetType,
    targetId: log.targetId,
    occurredAt: log.occurredAt,
  };
}
