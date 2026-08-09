import { Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { DomainException } from '../common/error-code';
import {
  PROGRAM_OVERVIEW_ERROR_CODES,
  ProgramOverviewErrorCode,
} from './program-overview-error-code.enum';
import {
  MilestoneDocumentCatalogEntry,
  MilestoneSchedule,
  ProgramOverviewRecord,
  ProgramOverviewRepository,
  PublicTeamRow,
} from './program-overview.repository';

/**
 * 팩트 바의 역할별 자리(#619 `docs/design.md` §업무 화면 내비게이션). 학생은 "내 제출 N/M 서류"
 * (myDocumentsCompleted/myDocumentsTotal), 교직원은 "제출률 N/participantCount"
 * (fullySubmittedParticipantCount, 분모는 ProgramOverviewRecord.participantCount)를
 * 채운다. role이 STUDENT/STAFF/ADMIN이 아니거나(예: 역할 미확정) 서류가 걸린 마일스톤이
 * 프로그램에 없으면 전부 null이다.
 *
 * 사이드바 depth-1용 `milestoneDocuments`는 프론트
 * `ProgramScopeMilestoneDocsSummary`와 필드명이 같다(milestoneId/title/completed/total).
 */
export interface ProgramOverviewViewerStats {
  role: Role | null;
  myDocumentsCompleted: number | null;
  myDocumentsTotal: number | null;
  fullySubmittedParticipantCount: number | null;
  /**
   * 마일스톤별 서류 분해(#619 sidebar 중첩 뱃지) — 서류 0개 마일스톤은 뺀다.
   * 응답 JSON 키는 `milestoneDocuments`.
   */
  milestoneDocuments: ProgramOverviewMilestoneDocument[];
}

/**
 * 프론트 `ProgramScopeMilestoneDocsSummary`와 동일 계약.
 * - STUDENT: completed=내가 낸 서류 수, total=그 마일스톤 서류 총수
 * - STAFF/ADMIN: completed=필수 서류 전부 낸 팀 수, total=참여 팀 수(teamCount)
 *   (프론트는 STAFF 분모로 응답 total 대신 상위 teamCount를 쓰지만, 값 자체는 팀 수다)
 */
export interface ProgramOverviewMilestoneDocument {
  milestoneId: string;
  title: string;
  completed: number;
  total: number;
}

export interface ProgramOverviewNextMilestone {
  label: string;
  dueAt: Date;
}

export interface ProgramOverviewView extends ProgramOverviewRecord {
  viewer: ProgramOverviewViewerStats;
  /** 마감 카운트다운 — 아직 마감되지 않은 가장 이른 마일스톤. 없으면 null(역할 무관 공통값). */
  nextMilestone: ProgramOverviewNextMilestone | null;
}

const EMPTY_VIEWER_STATS: ProgramOverviewViewerStats = {
  role: null,
  myDocumentsCompleted: null,
  myDocumentsTotal: null,
  fullySubmittedParticipantCount: null,
  milestoneDocuments: [],
};

/** dueAt이 아직 지나지 않은(> now) 마일스톤 중 가장 이른 것. 없으면 null. */
function pickNextMilestone(
  schedules: readonly MilestoneSchedule[],
  now: Date,
): ProgramOverviewNextMilestone | null {
  const upcoming = schedules.filter(
    (schedule) => schedule.dueAt.getTime() > now.getTime(),
  );
  if (upcoming.length === 0) {
    return null;
  }
  const earliest = upcoming.reduce((soonest, schedule) =>
    schedule.dueAt.getTime() < soonest.dueAt.getTime() ? schedule : soonest,
  );
  return { label: earliest.label, dueAt: earliest.dueAt };
}

/** 서류 0개 마일스톤은 breakdown에서 뺀다(#619). */
function excludeEmptyDocumentEntries(
  entries: ProgramOverviewMilestoneDocument[],
): ProgramOverviewMilestoneDocument[] {
  return entries.filter((entry) => entry.total > 0);
}

function documentedCatalog(
  catalog: readonly MilestoneDocumentCatalogEntry[],
): MilestoneDocumentCatalogEntry[] {
  return catalog.filter((entry) => entry.documentIds.length > 0);
}

/**
 * viewerDocuments(부모 "내 제출물" 합계) 범위 = **프로그램 전체 서류 합계**.
 * 근거: 프론트 사이드바 표본(parent 2/6, child 2/3)과 프로토타입 전체 합계 관례.
 * 현재 마일스톤만 세면 depth 합계와 depth-1 자식 합이 어긋난다.
 */
function sumStudentDocuments(
  catalog: readonly MilestoneDocumentCatalogEntry[],
  submittedDocumentIds: ReadonlySet<string>,
): { completed: number; total: number } {
  let completed = 0;
  let total = 0;
  for (const entry of documentedCatalog(catalog)) {
    total += entry.documentIds.length;
    completed += entry.documentIds.filter((id) =>
      submittedDocumentIds.has(id),
    ).length;
  }
  return { completed, total };
}

/**
 * 프로그램 상세 화면 상단 요약(#619) — 공개 집계(참여 학생·팀·연결 저장소 수)와
 * viewer 전용 집계(학생의 내 제출, 교직원의 제출률)를 함께 채운다. viewer 수치는
 * SessionGuard가 보장하는 인증된 요청에만 계산된다 — 값이 없을 수 있는 경우(역할
 * 미확정, 서류 걸린 마일스톤 없음, 신청 없음)는 항상 null/0으로 그레이스풀하게
 * 떨어진다. 공개 팀 목록(getPublicTeams)은 저장소 URL·학번·연락처·이메일을 절대
 * 노출하지 않는 별도 dedicated public query repository 메서드를 그대로 통과시킨다.
 */
@Injectable()
export class ProgramOverviewService {
  constructor(private readonly repository: ProgramOverviewRepository) {}

  async getOverview(
    programId: string,
    viewerGithubId: bigint,
  ): Promise<ProgramOverviewView> {
    const overview = await this.repository.findByProgramId(programId);
    if (!overview) {
      throw new DomainException(
        PROGRAM_OVERVIEW_ERROR_CODES[
          ProgramOverviewErrorCode.PROGRAM_NOT_FOUND
        ],
      );
    }

    const [viewer, milestoneSchedules] = await Promise.all([
      this.resolveViewerStats(programId, viewerGithubId, overview.teamCount),
      this.repository.findMilestoneSchedules(programId),
    ]);
    return {
      ...overview,
      viewer,
      nextMilestone: pickNextMilestone(milestoneSchedules, new Date()),
    };
  }

  async getPublicTeams(programId: string): Promise<PublicTeamRow[]> {
    const exists = await this.repository.programExists(programId);
    if (!exists) {
      throw new DomainException(
        PROGRAM_OVERVIEW_ERROR_CODES[
          ProgramOverviewErrorCode.PROGRAM_NOT_FOUND
        ],
      );
    }
    return this.repository.listPublicTeams(programId);
  }

  private async resolveViewerStats(
    programId: string,
    viewerGithubId: bigint,
    teamCount: number,
  ): Promise<ProgramOverviewViewerStats> {
    const identity = await this.repository.findViewerIdentity(viewerGithubId);
    if (!identity || identity.role === null) {
      return { ...EMPTY_VIEWER_STATS, role: identity?.role ?? null };
    }

    if (identity.role === Role.STUDENT) {
      return this.resolveStudentStats(programId, identity.userId);
    }
    if (identity.role === Role.STAFF || identity.role === Role.ADMIN) {
      return this.resolveStaffStats(programId, identity.role, teamCount);
    }
    return { ...EMPTY_VIEWER_STATS, role: identity.role };
  }

  private async resolveStudentStats(
    programId: string,
    userId: string,
  ): Promise<ProgramOverviewViewerStats> {
    // 서류가 있는 마일스톤이 하나도 없으면 사이드바·팩트 바 수치를 비운다.
    const hasDocuments = await this.repository.findCurrentSubmissionMilestone(
      programId,
      new Date(),
    );
    if (!hasDocuments) {
      return { ...EMPTY_VIEWER_STATS, role: Role.STUDENT };
    }

    const [applicationId, catalog] = await Promise.all([
      this.repository.findViewerApplicationId(programId, userId),
      this.repository.findMilestoneDocumentCatalog(programId),
    ]);
    const allDocumentIds = catalog.flatMap((entry) => entry.documentIds);
    const submittedDocumentIds = applicationId
      ? await this.repository.findSubmittedDocumentIds(
          applicationId,
          allDocumentIds,
        )
      : new Set<string>();
    const { completed, total } = sumStudentDocuments(
      catalog,
      submittedDocumentIds,
    );

    return {
      role: Role.STUDENT,
      myDocumentsCompleted: completed,
      myDocumentsTotal: total,
      fullySubmittedParticipantCount: null,
      milestoneDocuments: excludeEmptyDocumentEntries(
        catalog.map((entry) => ({
          milestoneId: entry.milestoneId,
          title: entry.title,
          completed: entry.documentIds.filter((id) =>
            submittedDocumentIds.has(id),
          ).length,
          total: entry.documentIds.length,
        })),
      ),
    };
  }

  private async resolveStaffStats(
    programId: string,
    role: typeof Role.STAFF | typeof Role.ADMIN,
    teamCount: number,
  ): Promise<ProgramOverviewViewerStats> {
    const milestone = await this.repository.findCurrentSubmissionMilestone(
      programId,
      new Date(),
    );
    if (!milestone) {
      return { ...EMPTY_VIEWER_STATS, role };
    }

    const [fullySubmittedParticipantCount, catalog] = await Promise.all([
      this.repository.countFullySubmittedParticipants(
        programId,
        milestone.requiredDocumentIds,
      ),
      this.repository.findMilestoneDocumentCatalog(programId),
    ]);
    const withDocuments = documentedCatalog(catalog);
    const completedByMilestone =
      await this.repository.countFullySubmittedTeamsByMilestone(
        programId,
        withDocuments,
      );

    return {
      role,
      myDocumentsCompleted: null,
      myDocumentsTotal: null,
      fullySubmittedParticipantCount,
      milestoneDocuments: withDocuments.map((entry) => ({
        milestoneId: entry.milestoneId,
        title: entry.title,
        completed: completedByMilestone.get(entry.milestoneId) ?? 0,
        // D5/D6: 서류 현황 분모는 항상 참여 팀 수.
        total: teamCount,
      })),
    };
  }
}
