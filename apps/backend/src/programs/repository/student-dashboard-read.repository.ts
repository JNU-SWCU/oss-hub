import { Injectable } from '@nestjs/common';
import {
  type ApplicationStatus,
  MilestoneDocumentKind,
  type MilestoneSubmissionType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  submissionCompletionTargetSelect,
  type SubmissionCompletionTargetRow,
} from '../../submissions/submission-completion-projection';
import { programApplicationParticipantWhere } from '../program-participant';

export interface StudentDashboardMilestoneRow {
  readonly id: string;
  readonly name: string;
  readonly dueAt: Date;
  readonly submissionType: MilestoneSubmissionType | null;
  readonly documents: readonly { readonly id: string }[];
}

/**
 * 대시보드 카드 한 장을 만드는 데 **실제로 쓰는 것만** 담는다.
 *
 * `applicant`(신청자 기록)는 일부러 없다 — 카드가 보여 줄 이름은 **지금 그 팀의 이름**이고,
 * 신청자 스칼라는 누가 처음 냈는지의 기록일 뿐이라 팀을 떠난 사람의 이름을 계속 띄운다.
 */
export interface StudentDashboardApplicationRow {
  readonly id: string;
  readonly status: ApplicationStatus;
  readonly team: { readonly name: string };
  readonly program: {
    readonly id: string;
    readonly name: string;
    readonly milestones: readonly StudentDashboardMilestoneRow[];
  };
  readonly milestoneDocumentSubmissions: readonly SubmissionCompletionTargetRow[];
}

export const studentDashboardApplicationSelect = {
  id: true,
  status: true,
  team: { select: { name: true } },
  program: {
    select: {
      id: true,
      name: true,
      milestones: {
        orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          name: true,
          dueAt: true,
          submissionType: true,
          // ⚠ 필수 서류만 — 선택 서류가 섞이면 안 낸 선택 서류가 마일스톤을 영원히
          // 미완료로 잡아 둔다(`programs.repository.ts` 의 상세 조회와 같은 조건).
          documents: {
            where: { required: true, kind: MilestoneDocumentKind.DOCUMENT },
            select: { id: true },
          },
        },
      },
    },
  },
  // 원장을 통째로 읽는다. 옛 방식 슬롯만 골라 오면 새 서류 항목의 제출이 한 건도
  // 도착하지 않아, 다 내고 승인까지 받은 학생이 첫 마일스톤에 갇힌다(#1091).
  milestoneDocumentSubmissions: { select: submissionCompletionTargetSelect },
} as const satisfies Prisma.ApplicationSelect;

/**
 * 학생 대시보드가 읽는 Prisma 조회 한 곳. service 는 Prisma 를 직접 잡지 않는다.
 *
 * ⚠ 이름이 `StudentDashboardReadRepository` 인 것은 service 의
 * `StudentDashboardRepository`(카드에 실리는 **저장소 발급 상태 뷰**)와 다른 것이기
 * 때문이다. 둘을 같은 이름으로 부르면 저장소 상태 뷰와 데이터 접근 계층이 섞인다.
 */
@Injectable()
export class StudentDashboardReadRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * **지금 그 팀에 속한 사람**의 신청만 준다.
   *
   * 판정은 `programApplicationParticipantWhere` 하나에 맡긴다 — 신청서를 읽을 수 있는
   * 사람의 정의는 그 함수가 원본이고, 여기에 `applicant`/`team.leader` 절을 더하면
   * 팀을 떠난 옛 신청자가 대시보드에서만 카드를 계속 들고 있게 된다. 개인 참여도 1인
   * 팀이므로(D5) 이 한 절이 모든 참여자를 담는다.
   *
   * 그 함수가 `userId`로 판정하므로 session 의 GitHub id 를 먼저 사용자 행으로 바꾼다.
   * 같은 조건을 githubId 판으로 다시 적으면 멤버십 규칙이 두 벌이 된다.
   */
  async findParticipatingApplications(
    sessionGithubId: bigint,
  ): Promise<readonly StudentDashboardApplicationRow[]> {
    const user = await this.prisma.user.findUnique({
      where: { githubId: sessionGithubId },
      select: { id: true },
    });
    if (user === null) return [];

    return this.prisma.application.findMany({
      where: programApplicationParticipantWhere(user.id),
      orderBy: [{ submittedAt: 'desc' }, { id: 'asc' }],
      select: studentDashboardApplicationSelect,
    });
  }
}
