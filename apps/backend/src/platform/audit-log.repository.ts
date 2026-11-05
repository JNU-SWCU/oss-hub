import type { AuditLogTransactionWriter } from './audit-log-transaction-writer.types';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';
import type { AuditLogListQuery } from './audit-log-query.types';
import { AUDIT_LOG_FEED_CTE } from './audit-log-feed.config';

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

export type AuditLogRow = Omit<
  Prisma.AuditLogGetPayload<{ select: typeof auditLogSelect }>,
  'actor'
> & {
  readonly actor: { readonly nickname: string } | null;
  readonly legacySource?: boolean;
  readonly historyKind?: string | null;
};

type AuditLogQueryRow =
  | (AuditLogRow & { readonly total: number })
  | { readonly id: null; readonly total: number };

export type AuditLogRowPage = {
  readonly rows: readonly AuditLogRow[];
  readonly total: number;
};

@Injectable()
export class AuditLogRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: AuditLogListQuery): Promise<AuditLogRowPage> {
    const predicates: Prisma.Sql[] = [];
    if (query.actor)
      predicates.push(Prisma.sql`actor."login" ILIKE ${`%${query.actor}%`}`);
    if (query.action)
      predicates.push(Prisma.sql`event."action" = ${query.action}`);
    if (query.from)
      predicates.push(
        Prisma.sql`event."occurredAt" >= ${new Date(`${query.from}T00:00:00.000+09:00`)}`,
      );
    if (query.to)
      predicates.push(
        Prisma.sql`event."occurredAt" <= ${new Date(`${query.to}T23:59:59.999+09:00`)}`,
      );
    const where = predicates.length
      ? Prisma.sql`WHERE ${Prisma.join(predicates, ' AND ')}`
      : Prisma.empty;
    const result = await this.prisma.$queryRaw<AuditLogQueryRow[]>`
      ${Prisma.raw(AUDIT_LOG_FEED_CTE)}, filtered AS (
        SELECT event."id", event."occurredAt", event."action", event."targetType",
          event."targetId", event."metadata", event."legacySource", event."historyKind",
          CASE WHEN actor."id" IS NULL THEN NULL
            ELSE jsonb_build_object('nickname', actor."login") END AS "actor"
        FROM events event LEFT JOIN "User" actor ON actor."id" = event."actorId"
        ${where}
      )
      SELECT totals."total", page.*
      FROM (SELECT count(*)::integer AS "total" FROM filtered) totals
      LEFT JOIN LATERAL (
        SELECT * FROM filtered ORDER BY "occurredAt" DESC, "id" DESC
        OFFSET ${(query.page - 1) * query.limit} LIMIT ${query.limit}
      ) page ON true
      ORDER BY page."occurredAt" DESC, page."id" DESC
    `;
    return {
      rows: result.flatMap((row) => (row.id === null ? [] : [row])),
      total: result[0]?.total ?? 0,
    };
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
    return this.prisma.$queryRaw<{ id: string; program: { name: string } }[]>`
      SELECT mapping."applicationId" AS id, jsonb_build_object('name', p.name) AS program
      FROM program_team_backup.application_team_map mapping
      JOIN "Team" t ON t.id = mapping."teamId"
      JOIN "Program" p ON p.id = t."programId"
      WHERE mapping."applicationId" = ANY(${[...ids]}::text[])
    `;
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
