import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { MemberRegistrationResetRepository } from './member-registration-reset.repository';

@Injectable()
export class LegacyMemberRegistrationResetRepository extends MemberRegistrationResetRepository {
  override async hasActivity(
    transaction: Prisma.TransactionClient,
    userId: string,
  ): Promise<boolean> {
    return (
      (await transaction.user.count({
        where: {
          id: userId,
          OR: [
            { applications: { some: {} } },
            { processedApplications: { some: {} } },
            { applicationReviewHistories: { some: {} } },
            { ledTeams: { some: {} } },
            { teamMemberships: { some: {} } },
            { receivedTeamInvitations: { some: {} } },
            { sentTeamInvitations: { some: {} } },
            { applicationPreparations: { some: {} } },
            { preparationParticipants: { some: {} } },
            { uploadedFiles: { some: {} } },
            { milestoneDocumentSubmissions: { some: {} } },
            { milestoneDocumentSubmissionHistories: { some: {} } },
            { milestoneDocumentReviewHistories: { some: {} } },
            { uploadedMilestoneDocumentTemplateFiles: { some: {} } },
            { programAuthoringUploads: { some: {} } },
            { createdPrograms: { some: {} } },
            { approvalDecisions: { some: {} } },
            { adminGrants: { some: {} } },
          ],
        },
      })) > 0
    );
  }
}
