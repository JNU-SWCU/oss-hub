import { Injectable } from '@nestjs/common';
import { type AccountStatus, type Prisma, type Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  parseAuditLogMetadata,
  type AuditLogMetadata,
  type AuditLogMetadataEvidence,
  type AuditLogMetadataView,
} from './audit-log-metadata';
import type { AuditLogListQueryRequestDto } from './dto/audit-log-query.dto';

// resolveAuditTargetLabel이 join으로 찾은 이름에 쓰는 targetType이다. Program은 하드
// 삭제되지 않으므로(soft-delete 필드도 없다) targetId로 다시 조회하면 스냅샷이 없는
// 과거 행도 이름을 되찾을 수 있다 — 이번 작업은 PROGRAM만 다룬다(다른 targetType은
// 별건). 스냅샷 우선순위는 스냅샷 > join > cuid 폴백.
const PROGRAM_TARGET_TYPE = 'PROGRAM';

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
  // 사람이 읽을 수 있는 대상 라벨. ACCESS_AUDIT schemaVersion 2 행은 대상의 이벤트
  // 시점 GitHub 로그인, PROGRAM_LIFECYCLE schemaVersion 2 행은 이벤트 시점 프로그램
  // 이름, 스냅샷이 없는 PROGRAM 대상 행은 join으로 찾은 현재 이름이다. 그 밖(다른
  // targetType의 v1·legacy, 또는 join도 실패한 경우)은 `targetType / targetId` 폴백이다.
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
    const evidenceByLog = logs.map((log) =>
      parseAuditLogMetadata(log.metadata),
    );
    const programNameById = await this.resolveProgramNames(logs, evidenceByLog);
    const items = logs.map((log, index) =>
      toAuditLogRecord(log, evidenceByLog[index]!, programNameById),
    );
    return { items, total };
  }

  // 스냅샷(schemaVersion 2)이 없는 PROGRAM 대상 행만 골라 targetId를 한 번에 모아
  // 조회한다 — 행마다 개별 조회하면 페이지 크기만큼 N+1 쿼리가 생긴다. Program이
  // 하드 삭제되지 않으므로(soft-delete 필드도 없다) join으로 찾지 못하면 그 프로그램
  // 행 자체가 없다는 뜻이라 cuid 폴백을 그대로 둔다.
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
    // 방금 쓴 행이므로 join 폴백이 필요 없다 — 새 쓰기 경로는 항상 최신 스키마
    // 버전(스냅샷 포함)으로 기록한다.
    return toAuditLogRecord(
      log,
      parseAuditLogMetadata(log.metadata),
      new Map(),
    );
  }
}

// schemaVersion 2 PROGRAM_LIFECYCLE metadata인지 판별한다. `'programName' in`으로
// 좁히면 스키마 버전 숫자가 다른 metadata 종류(ACCESS_AUDIT V2도 2)와 우연히 겹쳐도
// 안전하다 — programName 필드는 이 종류에만 존재한다.
function hasProgramNameSnapshot(evidence: AuditLogMetadataEvidence): boolean {
  return !evidence.legacy && 'programName' in evidence.metadata;
}

function toAuditLogRecord(
  log: PrismaAuditLog,
  evidence: AuditLogMetadataEvidence,
  programNameById: ReadonlyMap<string, string>,
): AuditLogRecord {
  const target = resolveAuditTargetLabel(
    log.targetType,
    log.targetId,
    evidence,
    programNameById,
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

// 라벨 우선순위: 이벤트 시점 스냅샷 > (PROGRAM만) join으로 찾은 현재 이름 > cuid 폴백.
// `'target' in`/`'programName' in`으로 판별한다 — schemaVersion 숫자는 metadata
// 종류마다 재사용되므로(ACCESS_AUDIT V2도 2, PROGRAM_LIFECYCLE V2도 2) 숫자만으로는
// 종류를 구분할 수 없다.
function resolveAuditTargetLabel(
  targetType: string,
  targetId: string,
  evidence: AuditLogMetadataEvidence,
  programNameById: ReadonlyMap<string, string>,
): string {
  if (!evidence.legacy && 'target' in evidence.metadata) {
    return evidence.metadata.target.githubLogin;
  }
  if (!evidence.legacy && 'programName' in evidence.metadata) {
    return evidence.metadata.programName;
  }
  if (targetType === PROGRAM_TARGET_TYPE) {
    const joinedName = programNameById.get(targetId);
    if (joinedName) {
      return joinedName;
    }
  }
  return `${targetType} / ${targetId}`;
}
