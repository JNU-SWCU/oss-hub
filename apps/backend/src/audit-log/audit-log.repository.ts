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

// resolveAuditTargetLabel이 join으로 찾은 이름에 쓰는 targetType들이다. PROGRAM·
// REPOSITORY·APPLICATION 모두 하드 삭제되지 않으므로(soft-delete 필드도 없다) targetId로
// 다시 조회하면 스냅샷이 없는 과거 행도 이름을 되찾을 수 있다. 스냅샷 우선순위는
// 스냅샷 > join > cuid 폴백.
//
// ROLE_REQUEST/USER(access-audit) 대상은 여기서 join하지 않는다 — 이 두 targetType은
// 이미 2026-08-01(admin-access-audit.ts)부터 모든 새 행이 스냅샷을 남기므로 스냅샷 없는
// 새 legacy 행이 더 늘지 않고, 과거 legacy 행은 ADR-007(명시적 fallback 계약)이 금지하는
// "조회 시점에 현재 User 테이블을 다시 조회해 과거 사실을 재구성"에 정확히 해당한다.
// PROGRAM/REPOSITORY의 join은 성격이 다르다 — User 신원(로그인·개명)이 아니라 엔티티
// (프로그램/저장소) 이름 표시일 뿐이고, ADR-007이 실제로 금지하는 사례(과거 GitHub
// 로그인 재구성)와 달리 "지금 이름이 다르면 지금 이름을 보여준다"는 오차가 감사 목적
// (누가 무엇을 했는가 추적)을 해치지 않는다. 이 판단은 PROGRAM(기존)에 이미 적용된
// 전례를 REPOSITORY까지 넓힌 것이며, 다르게 보는 시각이 있다면 ADR-007을 개정해 범위를
// 명시하는 편이 이 파일에 예외를 흩뿌리는 것보다 낫다.
//
// APPLICATION의 join(resolveApplicationLabels)은 **프로그램 이름만** 가져온다 —
// 신청자(applicant)는 User이고 그 로그인은 사람 신원이라 ADR-007이 금지하는 대상 그
// 자체다. 한때 이 join이 `applicant.nickname`(=GitHub 로그인)까지 같이 읽어 라벨에
// 합성한 적이 있었는데(#790 리뷰 지적), 이는 "조회 시점에 현재 User 테이블을 다시
// 조회해 과거 사실을 재구성"하는 행위와 정확히 같다 — 신청자가 그 뒤 로그인을 바꾸면
// 판정 당시 존재하지도 않았던 이름이 과거 행에 붙어 원장의 역사를 왜곡한다. 그래서
// v1(스냅샷 없는) 행은 프로그램 이름만 join하고 로그인은 절대 채우지 않는다 — v2
// 스냅샷 행만 작성 시점 로그인을 담을 자격이 있다(그건 그 시점의 사실이니까).
// resolveApplicationLabels의 select에 applicant를 다시 넣기 전에 이 주석을 먼저 보라.
const PROGRAM_TARGET_TYPE = 'PROGRAM';
const REPOSITORY_TARGET_TYPE = 'REPOSITORY';
const APPLICATION_TARGET_TYPE = 'APPLICATION';
// TEAM is snapshot-only (ADR-007). Do not add a list-time Team join.

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
  // 시점 GitHub 로그인, PROGRAM_LIFECYCLE/REPOSITORY_PUBLISH schemaVersion 2 행은
  // 이벤트 시점 프로그램 이름/저장소 전체 이름, APPLICATION_DECISION schemaVersion 2
  // 행은 "프로그램 이름 · @신청자 로그인" 합성 라벨이다. 스냅샷이 없는 PROGRAM/
  // REPOSITORY/APPLICATION 대상 행은 join으로 찾은 현재 이름/라벨이다. 그 밖(ROLE_REQUEST/
  // USER의 v1·legacy, 또는 join도 실패한 경우)은 `targetType / targetId` 폴백이다.
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

  // resolveProgramNames와 같은 이유(N+1 방지)로 REPOSITORY 대상 행만 배치 조회한다.
  // Repository도 하드 삭제되지 않으므로 join 실패는 "그 저장소 행 자체가 없다"는 뜻이다.
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

  // resolveProgramNames와 같은 이유(N+1 방지)로 APPLICATION 대상 행만 배치 조회한다.
  // v2 스냅샷과 달리 이 join은 **프로그램 이름만** 라벨로 쓴다 — applicant(신청자)는
  // User이고 그 로그인은 사람 신원이라 여기서 읽으면 ADR-007이 금지하는 "조회 시점에
  // 현재 User 테이블을 다시 조회해 과거 사실을 재구성"에 해당한다(파일 상단 주석
  // 참고). select에 applicant를 넣지 않는다 — 안 쓰는 게 아니라 애초에 안 읽는다.
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
    // 방금 쓴 행이므로 join 폴백이 필요 없다 — 새 쓰기 경로는 항상 최신 스키마
    // 버전(스냅샷 포함)으로 기록한다.
    return toAuditLogRecord(log, parseAuditLogMetadata(log.metadata), {
      programNameById: new Map(),
      repositoryFullNameById: new Map(),
      applicationLabelById: new Map(),
    });
  }
}

// list()가 join으로 채운 세 targetType의 이름/라벨 맵을 한데 묶는다. 매개변수가
// targetType 개수만큼 늘어나는 것을 막는다.
interface AuditTargetJoinMaps {
  readonly programNameById: ReadonlyMap<string, string>;
  readonly repositoryFullNameById: ReadonlyMap<string, string>;
  readonly applicationLabelById: ReadonlyMap<string, string>;
}

// schemaVersion 2 PROGRAM_LIFECYCLE metadata인지 판별한다. `'programName' in`으로
// 좁히면 스키마 버전 숫자가 다른 metadata 종류(ACCESS_AUDIT V2도 2)와 우연히 겹쳐도
// 안전하다 — 다만 APPLICATION_DECISION v2도 programName 필드를 갖고 있으므로, 이 판별은
// PROGRAM 대상 행에만 쓴다(resolveProgramNames가 targetType으로 이미 걸러 호출한다).
function hasProgramNameSnapshot(evidence: AuditLogMetadataEvidence): boolean {
  return !evidence.legacy && 'programName' in evidence.metadata;
}

// schemaVersion 2 REPOSITORY_PUBLISH metadata인지 판별한다. repositoryFullName은 이
// 종류에만 존재한다.
function hasRepositoryFullNameSnapshot(
  evidence: AuditLogMetadataEvidence,
): boolean {
  return !evidence.legacy && 'repositoryFullName' in evidence.metadata;
}

// schemaVersion 2 APPLICATION_DECISION metadata인지 판별한다. applicantGithubLogin은
// 이 종류에만 존재한다(programName은 PROGRAM_LIFECYCLE v2와 겹치므로 판별에 쓰지 않는다).
function hasApplicationDecisionSnapshot(
  evidence: AuditLogMetadataEvidence,
): boolean {
  return !evidence.legacy && 'applicantGithubLogin' in evidence.metadata;
}

// APPLICATION 대상 라벨은 "프로그램 이름 · @신청자 로그인" 한 문자열로 합성한다 —
// 프런트는 raw metadata에 접근하지 못하므로(parser.ts가 파싱 단계에서 버린다) 백엔드가
// 미리 합쳐서 내려줘야 화면이 두 조각을 따로 조립하지 않아도 된다. 스냅샷 경로(v2
// metadata)와 join 경로(resolveApplicationLabels) 양쪽에서 같은 함수를 써 형식이
// 갈라지지 않게 한다.
function composeApplicationTargetLabel(
  programName: string,
  applicantGithubLogin: string,
): string {
  return `${programName} · @${applicantGithubLogin}`;
}

function composeTeamTargetLabel(
  programName: string,
  teamName: string,
): string {
  return `${programName} · ${teamName}`;
}

function toAuditLogRecord(
  log: PrismaAuditLog,
  evidence: AuditLogMetadataEvidence,
  joinMaps: AuditTargetJoinMaps,
): AuditLogRecord {
  const target = resolveAuditTargetLabel(
    log.targetType,
    log.targetId,
    evidence,
    joinMaps,
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

// 라벨 우선순위: 이벤트 시점 스냅샷 > (PROGRAM/REPOSITORY/APPLICATION만) join으로 찾은
// 현재 이름 > cuid 폴백. `'target' in`/`'applicantGithubLogin' in`/
// teamName+programName / `'programName' in`/`'repositoryFullName' in`으로 판별한다 —
// schemaVersion 숫자는 metadata 종류마다 재사용되므로 숫자만으로는 종류를 구분할 수 없다.
// TEAM은 스냅샷만 쓴다(ADR-007). list-time Team join은 두지 않는다.
//
// APPLICATION_DECISION v2는 programName 필드도 가지고 있어(신청이 속한 프로그램 이름)
// 'programName' in 검사가 PROGRAM_LIFECYCLE v2와 겹친다 — applicantGithubLogin은
// APPLICATION_DECISION에만 있는 필드라 반드시 'programName' 검사보다 먼저 확인한다.
// teamName+programName compose는 그 다음이다. View가 teamName을 빼면 compose는
// 실패하고 programName만 남는다.
function resolveAuditTargetLabel(
  targetType: string,
  targetId: string,
  evidence: AuditLogMetadataEvidence,
  joinMaps: AuditTargetJoinMaps,
): string {
  if (!evidence.legacy && 'target' in evidence.metadata) {
    return evidence.metadata.target.githubLogin;
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
