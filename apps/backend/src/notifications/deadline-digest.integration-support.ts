import {
  ApplicationStatus,
  MilestoneSubmissionType,
  ProgramCategory,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { canonicalUserCreateFromLabel } from '../users/canonical-user-fixture';
import {
  DIGEST_APPLICATION_FIXTURES,
  DIGEST_FIXTURE,
  DIGEST_USER_FIXTURES,
  DIGEST_USER_IDS,
} from './deadline-digest.integration-fixtures';
import { DeadlineDigestRepository } from './deadline-digest.repository';
import { DeadlineDigestService } from './deadline-digest.service';
import type { DeadlineDigestMail, MailSender } from './mail-sender.port';
import { NotificationSettingsRepository } from './notification-settings.repository';

export { DIGEST_FIXTURE };

export class RecordingMailSender implements MailSender {
  readonly sent: DeadlineDigestMail[] = [];

  send(mail: DeadlineDigestMail): Promise<void> {
    this.sent.push(mail);
    return Promise.resolve();
  }
}

export class IsolatingMailSender implements MailSender {
  readonly attempted: DeadlineDigestMail[] = [];

  send(mail: DeadlineDigestMail): Promise<void> {
    this.attempted.push(mail);
    return mail.to === 'student-missing@example.com'
      ? Promise.reject(
          new Error(
            'SMTP rejected leaked-recipient@example.test token=synthetic-provider-token',
          ),
        )
      : Promise.resolve();
  }
}

export function createDeadlineDigestIntegrationHarness() {
  const prisma = new PrismaService();
  const repository = new DeadlineDigestRepository(prisma);
  const settingsRepository = new NotificationSettingsRepository(prisma);

  async function cleanup(): Promise<void> {
    await prisma.notification.deleteMany({
      where: { userId: { in: DIGEST_USER_IDS } },
    });
    await prisma.milestoneDocumentSubmission.deleteMany({
      where: { id: DIGEST_FIXTURE.documentSubmission },
    });
    await prisma.application.deleteMany({
      where: { id: { in: DIGEST_APPLICATION_FIXTURES.map(([id]) => id) } },
    });
    await prisma.teamMember.deleteMany({
      where: {
        teamId: {
          in: DIGEST_APPLICATION_FIXTURES.map(([id]) => `${id}-team`),
        },
      },
    });
    await prisma.team.deleteMany({
      where: {
        id: { in: DIGEST_APPLICATION_FIXTURES.map(([id]) => `${id}-team`) },
      },
    });
    await prisma.milestoneDocument.deleteMany({
      where: {
        id: {
          in: [DIGEST_FIXTURE.notifyDocument, DIGEST_FIXTURE.silentDocument],
        },
      },
    });
    await prisma.milestone.deleteMany({
      where: {
        id: {
          in: [DIGEST_FIXTURE.notifyMilestone, DIGEST_FIXTURE.silentMilestone],
        },
      },
    });
    await prisma.program.deleteMany({
      where: {
        id: {
          in: [DIGEST_FIXTURE.notifyProgram, DIGEST_FIXTURE.silentProgram],
        },
      },
    });
    await prisma.user.deleteMany({ where: { id: { in: DIGEST_USER_IDS } } });
  }

  async function seed(): Promise<void> {
    await prisma.program.createMany({
      data: [
        [DIGEST_FIXTURE.notifyProgram, true],
        [DIGEST_FIXTURE.silentProgram, false],
      ].map(([id, notifyOnDeadline]) => ({
        id: String(id),
        name: `synthetic ${id}`,
        organizer: 'synthetic-center',
        category: ProgramCategory.BASIC,
        applicationTemplateKey: 'basic',
        applicationTemplateVersion: 1,
        applicationStartAt: new Date('2026-08-01T00:00:00.000Z'),
        applicationEndAt: new Date('2026-08-31T00:00:00.000Z'),
        repositoryProvisioningEnabled: false,
        description: 'overview',
        notifyOnDeadline: Boolean(notifyOnDeadline),
      })),
    });
    await prisma.milestone.createMany({
      data: [
        {
          id: DIGEST_FIXTURE.notifyMilestone,
          programId: DIGEST_FIXTURE.notifyProgram,
          name: '최종 제출',
        },
        {
          id: DIGEST_FIXTURE.silentMilestone,
          programId: DIGEST_FIXTURE.silentProgram,
          name: '중간 제출',
        },
      ].map((milestone) => ({
        ...milestone,
        dueAt: DIGEST_FIXTURE.dueSoon,
        submissionType: MilestoneSubmissionType.TEXT,
      })),
    });
    await prisma.milestoneDocument.createMany({
      data: [
        {
          id: DIGEST_FIXTURE.notifyDocument,
          milestoneId: DIGEST_FIXTURE.notifyMilestone,
          name: `synthetic ${DIGEST_FIXTURE.notifyDocument}`,
          required: true,
          sortOrder: 1,
        },
        {
          id: DIGEST_FIXTURE.silentDocument,
          milestoneId: DIGEST_FIXTURE.silentMilestone,
          name: `synthetic ${DIGEST_FIXTURE.silentDocument}`,
          required: true,
          sortOrder: 1,
        },
      ],
    });
    for (const [
      id,
      githubId,
      role,
      notifyEnabled,
      notificationEmail,
      accountStatus,
    ] of DIGEST_USER_FIXTURES) {
      await prisma.user.create({
        data: {
          ...canonicalUserCreateFromLabel(role, {
            id: String(id),
            githubId,
            nickname: `synthetic-${id}`,
            accountStatus,
          }),
          notifyEnabled,
          notificationEmail,
        },
      });
    }
    await prisma.team.createMany({
      data: DIGEST_APPLICATION_FIXTURES.map(([applicationId, applicantId]) => ({
        id: `${applicationId}-team`,
        programId: DIGEST_FIXTURE.notifyProgram,
        name: `${applicationId}-team`,
        joinCodeDigest: `${applicationId}-digest`,
        leaderId: applicantId,
      })),
    });
    await prisma.teamMember.createMany({
      data: DIGEST_APPLICATION_FIXTURES.map(([applicationId, applicantId]) => ({
        id: `${applicationId}-member`,
        teamId: `${applicationId}-team`,
        programId: DIGEST_FIXTURE.notifyProgram,
        userId: applicantId,
      })),
    });
    await prisma.application.createMany({
      data: DIGEST_APPLICATION_FIXTURES.map(([applicationId, applicantId]) => ({
        id: applicationId,
        programId: DIGEST_FIXTURE.notifyProgram,
        applicantId,
        teamId: `${applicationId}-team`,
        answers: {},
        applicationTemplateVersion: 1,
        status: ApplicationStatus.APPROVED,
      })),
    });
    await prisma.milestoneDocumentSubmission.create({
      data: {
        id: DIGEST_FIXTURE.documentSubmission,
        applicationId: DIGEST_FIXTURE.submittedApplication,
        milestoneDocumentId: DIGEST_FIXTURE.notifyDocument,
        submittedById: DIGEST_FIXTURE.studentSubmitted,
      },
    });
  }

  return {
    prisma,
    repository,
    settingsRepository,
    connect: () => prisma.$connect(),
    reset: async () => {
      await cleanup();
      await seed();
    },
    disconnect: async () => {
      await cleanup();
      await prisma.$disconnect();
    },
    service: (mailSender: MailSender) =>
      new DeadlineDigestService(repository, mailSender, {
        FRONTEND_URL: 'https://oss.example',
      }),
  };
}
