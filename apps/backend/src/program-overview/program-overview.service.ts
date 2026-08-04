import { Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { DomainException } from '../common/error-code';
import {
  PROGRAM_OVERVIEW_ERROR_CODES,
  ProgramOverviewErrorCode,
} from './program-overview-error-code.enum';
import {
  ProgramOverviewRecord,
  ProgramOverviewRepository,
  PublicTeamRow,
} from './program-overview.repository';

/**
 * 팩트 바의 역할별 자리(#619 program-detail.md §3-6). 학생은 "내 제출 N/M 서류"
 * (myDocumentsCompleted/myDocumentsTotal), 교직원은 "제출률 N/participantCount"
 * (fullySubmittedParticipantCount, 분모는 ProgramOverviewRecord.participantCount)를
 * 채운다. role이 STUDENT/STAFF/ADMIN이 아니거나(예: 역할 미확정) 서류가 걸린 마일스톤이
 * 프로그램에 없으면 전부 null이다.
 */
export interface ProgramOverviewViewerStats {
  role: Role | null;
  myDocumentsCompleted: number | null;
  myDocumentsTotal: number | null;
  fullySubmittedParticipantCount: number | null;
}

export interface ProgramOverviewView extends ProgramOverviewRecord {
  viewer: ProgramOverviewViewerStats;
}

const EMPTY_VIEWER_STATS: ProgramOverviewViewerStats = {
  role: null,
  myDocumentsCompleted: null,
  myDocumentsTotal: null,
  fullySubmittedParticipantCount: null,
};

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

    const viewer = await this.resolveViewerStats(programId, viewerGithubId);
    return { ...overview, viewer };
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
  ): Promise<ProgramOverviewViewerStats> {
    const identity = await this.repository.findViewerIdentity(viewerGithubId);
    if (!identity || identity.role === null) {
      return { ...EMPTY_VIEWER_STATS, role: identity?.role ?? null };
    }

    if (identity.role === Role.STUDENT) {
      return this.resolveStudentStats(programId, identity.userId);
    }
    if (identity.role === Role.STAFF || identity.role === Role.ADMIN) {
      return this.resolveStaffStats(programId, identity.role);
    }
    return { ...EMPTY_VIEWER_STATS, role: identity.role };
  }

  private async resolveStudentStats(
    programId: string,
    userId: string,
  ): Promise<ProgramOverviewViewerStats> {
    const milestone = await this.repository.findCurrentSubmissionMilestone(
      programId,
      new Date(),
    );
    if (!milestone) {
      return { ...EMPTY_VIEWER_STATS, role: Role.STUDENT };
    }

    const applicationId = await this.repository.findViewerApplicationId(
      programId,
      userId,
    );
    const completed = applicationId
      ? await this.repository.countSubmittedDocuments(
          applicationId,
          milestone.documentIds,
        )
      : 0;

    return {
      role: Role.STUDENT,
      myDocumentsCompleted: completed,
      myDocumentsTotal: milestone.documentIds.length,
      fullySubmittedParticipantCount: null,
    };
  }

  private async resolveStaffStats(
    programId: string,
    role: typeof Role.STAFF | typeof Role.ADMIN,
  ): Promise<ProgramOverviewViewerStats> {
    const milestone = await this.repository.findCurrentSubmissionMilestone(
      programId,
      new Date(),
    );
    if (!milestone) {
      return { ...EMPTY_VIEWER_STATS, role };
    }

    const fullySubmittedParticipantCount =
      await this.repository.countFullySubmittedParticipants(
        programId,
        milestone.requiredDocumentIds,
      );

    return {
      role,
      myDocumentsCompleted: null,
      myDocumentsTotal: null,
      fullySubmittedParticipantCount,
    };
  }
}
