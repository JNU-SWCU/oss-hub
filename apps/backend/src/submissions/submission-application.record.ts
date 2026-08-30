import { MilestoneDocumentKind, Prisma } from '@prisma/client';
import type { SubmissionApplication } from './submissions.repository';

export function submissionParticipantWhere(
  userId: string,
): Prisma.ApplicationWhereInput {
  // 모든 신청이 Team을 갖고 개인 참여는 1인 팀이므로(D5) 팀 소속 하나로 판정한다.
  // 신청 생성 시 leader와 TeamMember 행을 함께 만들지만, 백필된 팀까지 포함해
  // 안전하게 잡으려면 두 경로를 모두 본다.
  return {
    team: {
      OR: [{ leaderId: userId }, { members: { some: { userId } } }],
    },
  };
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
    teamMemberCount: application.team?._count.members ?? 0,
    status: application.status,
    existingSubmission: application.milestoneDocumentSubmissions[0]
      ? {
          id:
            application.milestoneDocumentSubmissions[0].legacySubmissionId ??
            application.milestoneDocumentSubmissions[0].id,
          status: application.milestoneDocumentSubmissions[0].status,
        }
      : null,
  };
}
