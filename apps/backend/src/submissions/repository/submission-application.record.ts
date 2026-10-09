import { MilestoneDocumentKind, Prisma } from '@prisma/client';
import { programApplicationParticipantWhere } from '../../programs/program-participant';
import type { SubmissionApplication } from '../domain/submission-record';
import { publicSubmissionId } from '../domain/submission-public-id';

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
