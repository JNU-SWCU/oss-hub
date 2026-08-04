import { Prisma } from '@prisma/client';
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
    status: true,
    repository: { select: { url: true } },
    submissions: {
      where: { milestoneId },
      take: 1,
      select: { id: true, status: true },
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
    status: application.status,
    repositoryUrl: application.repository?.url ?? null,
    existingSubmission: application.submissions[0] ?? null,
  };
}
