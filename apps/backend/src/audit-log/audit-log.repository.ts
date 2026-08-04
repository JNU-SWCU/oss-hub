import { Injectable } from '@nestjs/common';
import { type AccountStatus, type Prisma, type Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  ACCESS_AUDIT_SCHEMA_VERSION,
  parseAuditLogMetadata,
  type AuditLogMetadata,
  type AuditLogMetadataEvidence,
  type AuditLogMetadataView,
} from './audit-log-metadata';
import type { AuditLogListQueryRequestDto } from './dto/audit-log-query.dto';

const auditLogSelect = {
  id: true,
  actor: { select: { nickname: true } },
  action: true,
  targetType: true,
  targetId: true,
  metadata: true,
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

type AuditLogRecordBase = {
  readonly id: string;
  readonly actor: string;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string;
  // schemaVersion 2 행은 대상의 이벤트 시점 GitHub 로그인, 그 밖(v1·legacy)은
  // `targetType / targetId` 폴백 라벨이다.
  readonly target: string;
  readonly occurredAt: Date;
};

// 응답에 실리는 metadata는 `AuditLogMetadataView` — 종류별로 등록한 필드만 남긴 형태다(#621).
// 저장 형태(`AuditLogMetadata`)는 `AuditLogRecordInput`에만 쓴다.
export type AuditLogRecord = AuditLogRecordBase &
  (
    | { readonly legacy: true; readonly metadata: null }
    | {
        readonly legacy: false;
        readonly metadata: AuditLogMetadataView;
      }
  );

export type AuditLogListResult = {
  readonly items: readonly AuditLogRecord[];
  readonly total: number;
};

export interface AuditLogRecordInput {
  readonly actorGithubId: bigint;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly metadata: AuditLogMetadata;
}

export interface AuditLogRepositoryPort {
  findActorByGithubId(githubId: bigint): Promise<AuditLogActor | null>;
  list(query: AuditLogListQueryRequestDto): Promise<AuditLogListResult>;
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

  async list(query: AuditLogListQueryRequestDto): Promise<AuditLogListResult> {
    const where: Prisma.AuditLogWhereInput = {
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
    };
    const [logs, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        select: auditLogSelect,
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { items: logs.map(toAuditLogRecord), total };
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
        metadata: input.metadata,
      },
      select: auditLogSelect,
    });
    return toAuditLogRecord(log);
  }
}

function toAuditLogRecord(log: PrismaAuditLog): AuditLogRecord {
  const evidence = parseAuditLogMetadata(log.metadata);
  const target = resolveAuditTargetLabel(
    log.targetType,
    log.targetId,
    evidence,
  );
  if (evidence.legacy) {
    return {
      id: log.id,
      actor: log.actor.nickname,
      action: log.action,
      targetType: log.targetType,
      targetId: log.targetId,
      target,
      occurredAt: log.occurredAt,
      legacy: true,
      metadata: null,
    };
  }
  return {
    id: log.id,
    actor:
      'actor' in evidence.metadata
        ? evidence.metadata.actor.githubLogin
        : log.actor.nickname,
    action: log.action,
    targetType: log.targetType,
    targetId: log.targetId,
    target,
    occurredAt: log.occurredAt,
    legacy: false,
    metadata: evidence.metadata,
  };
}

function resolveAuditTargetLabel(
  targetType: string,
  targetId: string,
  evidence: AuditLogMetadataEvidence,
): string {
  if (
    !evidence.legacy &&
    evidence.metadata.schemaVersion === ACCESS_AUDIT_SCHEMA_VERSION
  ) {
    return evidence.metadata.target.githubLogin;
  }
  return `${targetType} / ${targetId}`;
}
