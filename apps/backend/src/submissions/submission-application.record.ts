import { MilestoneDocumentKind, Prisma } from '@prisma/client';
import { programApplicationParticipantWhere } from '../programs/program-participant';
import { publicSubmissionId } from './submission-public-id';
import type { SubmissionApplication } from './submissions.repository';

/**
 * 제출 경로에서 「지금 이 신청의 참여자인가」를 판정한다 — 판정 원본은
 * `programApplicationParticipantWhere` 하나다(현재 `TeamMember` 행).
 *
 * ⚠ 예전에는 `team.leaderId` 절을 OR로 함께 봤다. 팀장 승계·탈퇴가 `Team.leaderId`와
 * `TeamMember` 집합을 함께 옮기므로, 팀장 절을 남겨 두면 팀을 떠난 옛 팀장이 그 사이
 * 상태에서 계속 제출·비공개 열람에 통과한다(#1269). 팀장도 항상 자기 팀의 `TeamMember`
 * 행을 갖고(신청 생성이 함께 만든다) 개인 참여도 1인 팀이라(D5) 멤버십 한 절이 모든
 * 참여자를 담는다. 이력의 `submittedById`·`applicantId`는 기록이지 권한이 아니다.
 *
 * `programId` 등 범위 조건은 호출부가 이 결과와 함께 spread 한다 — 시그니처는 그대로다.
 */
export function submissionParticipantWhere(
  userId: string,
): Prisma.ApplicationWhereInput {
  return programApplicationParticipantWhere(userId);
}

export const submissionApplicationSelect = (milestoneId: string) =>
  ({
    id: true,
    programId: true,
    teamId: true,
    // 개인 참여는 멤버가 1명뿐인 팀이다(D5·D6). 표시용 구분에 인원이 필요하다.
    team: { select: { _count: { select: { members: true } } } },
    status: true,
    milestoneDocumentSubmissions: {
      where: {
        milestoneDocument: {
          milestoneId,
          kind: MilestoneDocumentKind.LEGACY_MILESTONE_SUBMISSION,
        },
      },
      take: 1,
      select: { id: true, legacySubmissionId: true, status: true },
    },
  }) as const;

type ApplicationRecord = Prisma.ApplicationGetPayload<{
  select: ReturnType<typeof submissionApplicationSelect>;
}>;

export function toSubmissionApplication(
  application: ApplicationRecord,
): SubmissionApplication {
  return {
    id: application.id,
    programId: application.programId,
    teamId: application.teamId,
    teamMemberCount: application.team._count.members,
    status: application.status,
    existingSubmission: application.milestoneDocumentSubmissions[0]
      ? {
          id: publicSubmissionId(application.milestoneDocumentSubmissions[0]),
          status: application.milestoneDocumentSubmissions[0].status,
        }
      : null,
  };
}
