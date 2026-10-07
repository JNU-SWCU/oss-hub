import { Injectable } from '@nestjs/common';
import { type AccountStatus, type Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  parseAuditLogMetadata,
  type AuditLogMetadata,
  type AuditLogMetadataEvidence,
  type AuditLogMetadataView,
} from './audit-log-metadata';
import type { AuditLogListQueryRequestDto } from './dto/audit-log-query.dto';

const PROGRAM_TARGET_TYPE = 'PROGRAM';
const REPOSITORY_TARGET_TYPE = 'REPOSITORY';
const APPLICATION_TARGET_TYPE = 'APPLICATION';

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
  readonly hasStaffAccess: boolean;
  readonly hasAdminAccess: boolean;
  readonly accountStatus: AccountStatus;
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
      select: {
        id: true,
        hasStaffAccess: true,
        hasAdminAccess: true,
        accountStatus: true,
      },
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
    const evidenceByLog = logs.map((log) =>
      parseAuditLogMetadata(log.metadata),
    );
    const [programNameById, repositoryFullNameById, applicationLabelById] =
      await Promise.all([
        this.resolveProgramNames(logs, evidenceByLog),
        this.resolveRepositoryNames(logs, evidenceByLog),
        this.resolveApplicationLabels(logs, evidenceByLog),
      ]);
    const joinMaps: AuditTargetJoinMaps = {
      programNameById,
      repositoryFullNameById,
      applicationLabelById,
    };
    const items = logs.map((log, index) =>
      toAuditLogRecord(log, evidenceByLog[index]!, joinMaps),
    );
    return { items, total };
  }

  private async resolveProgramNames(
    logs: readonly PrismaAuditLog[],
    evidenceByLog: readonly AuditLogMetadataEvidence[],
  ): Promise<ReadonlyMap<string, string>> {
    const idsNeedingJoin = new Set<string>();
    logs.forEach((log, index) => {
      if (
        log.targetType === PROGRAM_TARGET_TYPE &&
        !hasProgramNameSnapshot(evidenceByLog[index]!)
      ) {
        idsNeedingJoin.add(log.targetId);
      }
    });
    if (idsNeedingJoin.size === 0) {
      return new Map();
    }
    const programs = await this.prisma.program.findMany({
      where: { id: { in: [...idsNeedingJoin] } },
      select: { id: true, name: true },
    });
    return new Map(programs.map((program) => [program.id, program.name]));
  }

  private async resolveRepositoryNames(
    logs: readonly PrismaAuditLog[],
    evidenceByLog: readonly AuditLogMetadataEvidence[],
  ): Promise<ReadonlyMap<string, string>> {
    const idsNeedingJoin = new Set<string>();
    logs.forEach((log, index) => {
      if (
        log.targetType === REPOSITORY_TARGET_TYPE &&
        !hasRepositoryFullNameSnapshot(evidenceByLog[index]!)
      ) {
        idsNeedingJoin.add(log.targetId);
      }
    });
    if (idsNeedingJoin.size === 0) {
      return new Map();
    }
    const repositories = await this.prisma.githubRepository.findMany({
      where: { id: { in: [...idsNeedingJoin] } },
      select: { id: true, nameWithOwner: true },
    });
    return new Map(
      repositories.map((repository) => [
        repository.id,
        repository.nameWithOwner,
      ]),
    );
  }

  private async resolveApplicationLabels(
    logs: readonly PrismaAuditLog[],
    evidenceByLog: readonly AuditLogMetadataEvidence[],
  ): Promise<ReadonlyMap<string, string>> {
    const idsNeedingJoin = new Set<string>();
    logs.forEach((log, index) => {
      if (
        log.targetType === APPLICATION_TARGET_TYPE &&
        !hasApplicationDecisionSnapshot(evidenceByLog[index]!) &&
        !hasProgramNameSnapshot(evidenceByLog[index]!)
      ) {
        idsNeedingJoin.add(log.targetId);
      }
    });
    if (idsNeedingJoin.size === 0) {
      return new Map();
    }
    const applications = await this.prisma.application.findMany({
      where: { id: { in: [...idsNeedingJoin] } },
      select: {
        id: true,
        program: { select: { name: true } },
      },
    });
    return new Map(
      applications.map((application) => [
        application.id,
        application.program.name,
      ]),
    );
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

    return toAuditLogRecord(log, parseAuditLogMetadata(log.metadata), {
      programNameById: new Map(),
      repositoryFullNameById: new Map(),
      applicationLabelById: new Map(),
    });
  }
}

interface AuditTargetJoinMaps {
  readonly programNameById: ReadonlyMap<string, string>;
  readonly repositoryFullNameById: ReadonlyMap<string, string>;
  readonly applicationLabelById: ReadonlyMap<string, string>;
}

function hasProgramNameSnapshot(evidence: AuditLogMetadataEvidence): boolean {
  return !evidence.legacy && 'programName' in evidence.metadata;
}

function hasRepositoryFullNameSnapshot(
  evidence: AuditLogMetadataEvidence,
): boolean {
  return !evidence.legacy && 'repositoryFullName' in evidence.metadata;
}

function hasApplicationDecisionSnapshot(
  evidence: AuditLogMetadataEvidence,
): boolean {
  return !evidence.legacy && 'applicantGithubLogin' in evidence.metadata;
}

function composeApplicationTargetLabel(
  programName: string,
  applicantGithubLogin: string,
): string {
  return `${programName} · @${applicantGithubLogin}`;
}

function composeTeamTargetLabel(programName: string, teamName: string): string {
  return `${programName} · ${teamName}`;
}

function personLabel(snapshot: {
  readonly displayName: string | null;
  readonly githubLogin: string;
}): string {
  const name = snapshot.displayName?.trim();
  return name ? name : snapshot.githubLogin;
}

function toAuditLogRecord(
  log: PrismaAuditLog,
  evidence: AuditLogMetadataEvidence,
  joinMaps: AuditTargetJoinMaps,
): AuditLogRecord {
  const people = resolveAuditPeople(log, evidence);
  const target = resolveAuditTargetLabel(
    log.targetType,
    log.targetId,
    evidence,
    joinMaps,
  );
  if (evidence.legacy) {
    return {
      id: log.id,
      actor: people.actor,
      actorHandle: people.actorHandle,
      action: log.action,
      targetType: log.targetType,
      targetId: log.targetId,
      target,
      targetHandle: people.targetHandle,
      occurredAt: log.occurredAt,
      legacy: true,
      metadata: null,
    };
  }
  return {
    id: log.id,
    actor: people.actor,
    actorHandle: people.actorHandle,
    action: log.action,
    targetType: log.targetType,
    targetId: log.targetId,
    target,
    targetHandle: people.targetHandle,
    occurredAt: log.occurredAt,
    legacy: false,
    metadata: evidence.metadata,
  };
}

function resolveAuditPeople(
  log: PrismaAuditLog,
  evidence: AuditLogMetadataEvidence,
): {
  readonly actor: string;
  readonly actorHandle: string | null;
  readonly targetHandle: string | null;
} {
  if (!evidence.legacy && 'actor' in evidence.metadata) {
    const actorSnapshot = evidence.metadata.actor;
    const targetSnapshot =
      'target' in evidence.metadata ? evidence.metadata.target : null;
    return {
      actor: personLabel(actorSnapshot),
      actorHandle: actorSnapshot.githubLogin,
      targetHandle: targetSnapshot ? targetSnapshot.githubLogin : null,
    };
  }
  return {
    actor: log.actor.nickname,
    actorHandle: log.actor.nickname,
    targetHandle: null,
  };
}

function resolveAuditTargetLabel(
  targetType: string,
  targetId: string,
  evidence: AuditLogMetadataEvidence,
  joinMaps: AuditTargetJoinMaps,
): string {
  if (!evidence.legacy && 'target' in evidence.metadata) {
    return personLabel(evidence.metadata.target);
  }
  if (!evidence.legacy && 'applicantGithubLogin' in evidence.metadata) {
    return composeApplicationTargetLabel(
      evidence.metadata.programName,
      evidence.metadata.applicantGithubLogin,
    );
  }
  if (
    !evidence.legacy &&
    'teamName' in evidence.metadata &&
    'programName' in evidence.metadata
  ) {
    return composeTeamTargetLabel(
      evidence.metadata.programName,
      evidence.metadata.teamName,
    );
  }
  if (!evidence.legacy && 'programName' in evidence.metadata) {
    return evidence.metadata.programName;
  }
  if (!evidence.legacy && 'repositoryFullName' in evidence.metadata) {
    return evidence.metadata.repositoryFullName;
  }
  if (targetType === PROGRAM_TARGET_TYPE) {
    const joinedName = joinMaps.programNameById.get(targetId);
    if (joinedName) {
      return joinedName;
    }
  }
  if (targetType === REPOSITORY_TARGET_TYPE) {
    const joinedName = joinMaps.repositoryFullNameById.get(targetId);
    if (joinedName) {
      return joinedName;
    }
  }
  if (targetType === APPLICATION_TARGET_TYPE) {
    const joinedLabel = joinMaps.applicationLabelById.get(targetId);
    if (joinedLabel) {
      return joinedLabel;
    }
  }
  return `${targetType} / ${targetId}`;
}
