import { Prisma } from '@prisma/client';
import type { SubmissionApplication } from './submissions.repository';

export function submissionParticipantWhere(
  userId: string,
): Prisma.ApplicationWhereInput {
  return {
    OR: [
      { teamId: null, applicantId: userId },
      { teamId: { not: null }, team: { leaderId: userId } },
      {
        teamId: { not: null },
        team: { members: { some: { userId } } },
      },
    ],
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
