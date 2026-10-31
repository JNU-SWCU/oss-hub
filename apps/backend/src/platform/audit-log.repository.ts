import type { AuditLogTransactionWriter } from './audit-log-transaction-writer.types';
import { Injectable } from '@nestjs/common';
import { type Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';
import type { AuditLogListQuery } from './audit-log-query.types';

import {
  type ApplicationRepositoryUrlAuditMetadata,
  type RepositoryConnectionAuditMetadata,
} from './repository-audit-metadata.config';
import {
  type CollectionTriggerAuditMetadata,
  type SubmissionFileCleanupAuditMetadata,
  ACCESS_AUDIT_ACTIONS,
  type AccessAuditMetadataV2,
  type AccessAuditMetadata,
  type ApplicationDecisionAuditMetadataV2,
  type ApplicationDecisionAuditMetadata,
  INDEPENDENT_AUTHORITY_AUDIT_ACTIONS,
  type IndependentAuthorityAuditMetadata,
  type RepositoryPublishAuditMetadataV2,
  type RepositoryPublishAuditMetadata,
  type ProgramLifecycleAuditMetadataV2,
  type ProgramLifecycleAuditMetadata,
  type ProgramDeletionAuditMetadata,
  type UserProfileAuditMetadata,
  type UserPhoneAuditMetadata,
  type ProgramCreatedAuditMetadata,
  type TeamCreatedAuditMetadata,
  type TeamJoinedAuditMetadata,
  type ApplicationSubmittedAuditMetadata,
  type TeamMembershipAuditMetadata,
  type TeamRenamedAuditMetadata,
  type TeamDeletedAuditMetadata,
  type AuditLogMetadataView,
  USER_PROFILE_AUDIT_ACTIONS,
} from './audit-log-metadata.config';

export type AccessAuditAction =
  (typeof ACCESS_AUDIT_ACTIONS)[keyof typeof ACCESS_AUDIT_ACTIONS];

type DistributiveOmit<T, Key extends PropertyKey> = T extends T
  ? Omit<T, Key>
  : never;

export type AccessAuditMetadataInput = DistributiveOmit<
  AccessAuditMetadataV2,
  'schemaVersion'
>;

export type ApplicationDecisionAuditMetadataInput = Omit<
  ApplicationDecisionAuditMetadataV2,
  'schemaVersion'
>;

export type IndependentAuthorityAuditAction =
  (typeof INDEPENDENT_AUTHORITY_AUDIT_ACTIONS)[keyof typeof INDEPENDENT_AUTHORITY_AUDIT_ACTIONS];

export type IndependentAuthorityAuditMetadataInput = Omit<
  IndependentAuthorityAuditMetadata,
  'schemaVersion' | 'eventKind'
>;

export type RepositoryPublishAuditMetadataInput = Omit<
  RepositoryPublishAuditMetadataV2,
  'schemaVersion'
>;

export type ProgramLifecycleAuditMetadataInput = Omit<
  ProgramLifecycleAuditMetadataV2,
  'schemaVersion'
>;

export type UserProfileAuditAction =
  (typeof USER_PROFILE_AUDIT_ACTIONS)[keyof typeof USER_PROFILE_AUDIT_ACTIONS];

type AuditLogMetadata =
  | ApplicationRepositoryUrlAuditMetadata
  | AccessAuditMetadata
  | IndependentAuthorityAuditMetadata
  | RepositoryConnectionAuditMetadata
  | RepositoryPublishAuditMetadata
  | ProgramLifecycleAuditMetadata
  | ProgramDeletionAuditMetadata
  | ProgramCreatedAuditMetadata
  | TeamCreatedAuditMetadata
  | TeamDeletedAuditMetadata
  | TeamJoinedAuditMetadata
  | TeamMembershipAuditMetadata
  | TeamRenamedAuditMetadata
  | ApplicationSubmittedAuditMetadata
  | CollectionTriggerAuditMetadata
  | SubmissionFileCleanupAuditMetadata
  | ApplicationDecisionAuditMetadata
  | UserProfileAuditMetadata
  | UserPhoneAuditMetadata;

export interface AuditLogRecordInput {
  readonly actorGithubId: bigint;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly metadata: AuditLogMetadata;
}

type AuditLogRecordBase = {
  readonly id: string;
  readonly actor: string;
  readonly actorHandle: string | null;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string;

  readonly target: string;
  readonly targetHandle: string | null;
  readonly occurredAt: Date;
};

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

export type AuditLogPage = AuditLogListResult & {
  readonly page: number;
  readonly limit: number;
};

const auditLogSelect = {
  id: true,
  actor: { select: { nickname: true } },
  action: true,
  targetType: true,
  targetId: true,
  metadata: true,
  occurredAt: true,
} satisfies Prisma.AuditLogSelect;

export type AuditLogRow = Prisma.AuditLogGetPayload<{
  select: typeof auditLogSelect;
}>;

export type AuditLogRowPage = {
  readonly rows: readonly AuditLogRow[];
  readonly total: number;
};

@Injectable()
export class AuditLogRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: AuditLogListQuery): Promise<AuditLogRowPage> {
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
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        select: auditLogSelect,
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { rows, total };
  }

  findProgramNames(ids: readonly string[]) {
    return this.prisma.program.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, name: true },
    });
  }

  findRepositoryNames(ids: readonly string[]) {
    return this.prisma.githubRepository.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, nameWithOwner: true },
    });
  }

  findApplicationProgramNames(ids: readonly string[]) {
    return this.prisma.application.findMany({
      where: { id: { in: [...ids] } },
      select: {
        id: true,
        program: { select: { name: true } },
      },
    });
  }

  async record(
    input: AuditLogRecordInput,
    writer: AuditLogTransactionWriter = this.prisma,
  ): Promise<AuditLogRow> {
    return writer.auditLog.create({
      data: {
        actor: { connect: { githubId: input.actorGithubId } },
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        metadata: input.metadata,
      },
      select: auditLogSelect,
    });
  }
}
