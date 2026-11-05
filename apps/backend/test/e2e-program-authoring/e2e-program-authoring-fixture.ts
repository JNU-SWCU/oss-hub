import {
  AccountStatus,
  ApplicationStatus,
  Prisma,
  ProgramCategory,
  ProgramLifecycle,
} from '@prisma/client';
import { stateForE2eProgramGraph } from './e2e-program-authoring-state';
import { removeAdoptedGraph } from './e2e-program-authoring-graph-cleanup';
import { e2eProgramAuthoringExternalPorts } from './e2e-external-ports';
import { adoptE2eProgramGraph } from './e2e-program-authoring-graph-adoption';
import { ensureE2eProgramAuthoringActors } from './e2e-program-authoring-actors';
import { deleteE2eProgramDeadlineClaims } from './e2e-program-authoring-notification-cleanup';
import type { E2eExternalCapture } from './e2e-external-port-registry';
import type {
  E2eProgramAuthoringGraph,
  E2eProgramAuthoringState,
} from './e2e-program-authoring.types';
import { PrismaService } from '../../src/platform/prisma.service';
import { CONSENT_POLICY_VERSION } from '../../src/users/consents.service';
const PREFIX = 'e2e:program-authoring:';
export const E2E_PROGRAM_ID = `${PREFIX}program`;
export const E2E_STAFF_ID = `${PREFIX}staff`;
export const E2E_STUDENT_ID = `${PREFIX}student`;
export const E2E_FOREIGN_STUDENT_ID = `${PREFIX}foreign-student`;
export const E2E_MILESTONE_ID = `${PREFIX}milestone`;
export const E2E_DOCUMENT_ID = `${PREFIX}document`;
export const E2E_STAFF_GITHUB_ID = 8100001n;
export const E2E_STUDENT_GITHUB_ID = 8100002n;
export const E2E_FOREIGN_STUDENT_GITHUB_ID = 8100003n;
export const E2E_REPOSITORY_WHERE = {
  OR: [
    { team: { programId: E2E_PROGRAM_ID } },
    { teamId: null, id: { startsWith: `${E2E_PROGRAM_ID}-` } },
  ],
} satisfies Prisma.GithubRepositoryWhereInput;
const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;
export const E2E_NOW = new Date(Date.now() + 2 * ONE_HOUR_MS);
export class E2eProgramAuthoringFixture {
  private activeGraph: E2eProgramAuthoringGraph | null = null;
  constructor(private readonly prisma: PrismaService) {}
  async reset(): Promise<void> {
    if (
      this.activeGraph !== null &&
      this.activeGraph.programId !== E2E_PROGRAM_ID
    ) {
      await removeAdoptedGraph(
        this.prisma,
        this.activeGraph,
        PREFIX,
        (storageKey) =>
          e2eProgramAuthoringExternalPorts.storage.delete(storageKey),
      );
      this.activeGraph = null;
    }
    const covers = await this.prisma.$transaction(async (transaction) => {
      const applications = await transaction.team.findMany({
        where: { programId: E2E_PROGRAM_ID },
        select: { id: true },
      });
      const teamIds = applications.map(({ id }) => id);
      await deleteE2eProgramDeadlineClaims(transaction, E2E_PROGRAM_ID);
      await transaction.notification.deleteMany({
        where: { userId: { in: [E2E_STAFF_ID, E2E_STUDENT_ID] } },
      });
      await transaction.outboxEvent.deleteMany({
        where: { aggregateId: { in: teamIds } },
      });
      await transaction.repositoryProvisionJob.deleteMany({
        where: { teamId: { in: teamIds } },
      });
      await transaction.repositoryInvitation.deleteMany({
        where: { repository: E2E_REPOSITORY_WHERE },
      });
      await transaction.githubRepository.deleteMany({
        where: E2E_REPOSITORY_WHERE,
      });
      await transaction.file.deleteMany({
        where: { kind: 'SUBMISSION', teamId: { in: teamIds } },
      });
      await transaction.milestoneDocumentSubmissionHistory.deleteMany({
        where: { submission: { teamId: { in: teamIds } } },
      });
      await transaction.milestoneDocumentSubmission.deleteMany({
        where: { teamId: { in: teamIds } },
      });
      await transaction.teamInvitation.deleteMany({
        where: { programId: E2E_PROGRAM_ID },
      });
      await transaction.teamMember.deleteMany({
        where: { programId: E2E_PROGRAM_ID },
      });
      await transaction.team.deleteMany({
        where: { programId: E2E_PROGRAM_ID },
      });
      await transaction.file.deleteMany({
        where: {
          kind: 'TEMPLATE',
          requirement: { milestoneId: E2E_MILESTONE_ID },
        },
      });
      await transaction.milestoneDocument.deleteMany({
        where: { milestoneId: E2E_MILESTONE_ID },
      });
      await transaction.milestone.deleteMany({
        where: { id: E2E_MILESTONE_ID },
      });
      await transaction.file.deleteMany({
        where: { kind: 'UPLOAD', uploaderId: E2E_STAFF_ID },
      });
      const covers = await transaction.file.findMany({
        where: { kind: 'COVER', programId: E2E_PROGRAM_ID },
        select: { storageKey: true },
      });
      await transaction.file.deleteMany({
        where: { kind: 'COVER', programId: E2E_PROGRAM_ID },
      });
      await transaction.program.deleteMany({ where: { id: E2E_PROGRAM_ID } });
      return covers;
    });
    for (const cover of covers) {
      if (cover.storageKey !== null)
        await e2eProgramAuthoringExternalPorts.storage.delete(cover.storageKey);
    }
    this.activeGraph = null;
  }
  async ensure(): Promise<void> {
    await this.ensureActors();
    await this.prisma.$transaction(async (transaction) => {
      await transaction.user.update({
        where: { id: E2E_STAFF_ID },
        data: {
          notificationEmail: null,
          notifyEnabled: false,
        },
      });
      await transaction.userPolicy.createMany({
        data: [E2E_STAFF_ID, E2E_STUDENT_ID, E2E_FOREIGN_STUDENT_ID].map(
          (userId) => ({ userId, policyVersion: CONSENT_POLICY_VERSION }),
        ),
        skipDuplicates: true,
      });
      await transaction.program.upsert({
        where: { id: E2E_PROGRAM_ID },
        create: {
          id: E2E_PROGRAM_ID,
          name: `${PREFIX}program`,
          organizer: `${PREFIX}organizer`,
          category: ProgramCategory.BASIC,
          lifecycle: ProgramLifecycle.PUBLISHED,
          applicationTemplateKey: 'basic',
          applicationTemplateVersion: 1,
          applicationStartAt: new Date(E2E_NOW.getTime() - 19 * ONE_DAY_MS),
          applicationEndAt: E2E_NOW,
          startAt: E2E_NOW,
          endAt: new Date(E2E_NOW.getTime() + 10 * ONE_DAY_MS),
          description: `${PREFIX}program`,
          repositoryProvisioningEnabled: true,
          notifyOnDeadline: true,
        },
        update: {},
      });
      await transaction.milestone.upsert({
        where: { id: E2E_MILESTONE_ID },
        create: {
          id: E2E_MILESTONE_ID,
          programId: E2E_PROGRAM_ID,
          name: `${PREFIX}milestone`,
          startAt: E2E_NOW,
          dueAt: new Date(E2E_NOW.getTime() + 9 * ONE_HOUR_MS),
        },
        update: {},
      });
      await transaction.milestoneDocument.upsert({
        where: { id: E2E_DOCUMENT_ID },
        create: {
          id: E2E_DOCUMENT_ID,
          milestoneId: E2E_MILESTONE_ID,
          name: `${PREFIX}document`,
          required: true,
          sortOrder: 0,
        },
        update: {},
      });
    });
    this.activeGraph = fixtureGraph();
  }
  async adopt(
    programId: string,
    authorGithubId: bigint,
  ): Promise<E2eProgramAuthoringGraph> {
    if (this.activeGraph !== null)
      throw new Error('An E2E graph is already active.');
    await this.ensureActors();
    const graph = await adoptE2eProgramGraph(
      this.prisma,
      programId,
      authorGithubId,
      PREFIX,
    );
    await this.prisma.user.updateMany({
      where: { type: 'STAFF', approvalStatus: 'APPROVED' },
      data: { notifyEnabled: false },
    });
    const author = await this.prisma.user.updateMany({
      where: {
        githubId: authorGithubId,
        type: 'STAFF',
        approvalStatus: 'APPROVED',
        accountStatus: AccountStatus.ACTIVE,
        profileCreatedAt: { not: null },
        name: { not: null },
        department: { not: null },
      },
      data: {
        notificationEmail: 'e2e-program-authoring-author@fixture.invalid',
        notifyEnabled: true,
      },
    });
    if (author.count !== 1)
      throw new Error('The adopted E2E author must be one active staff user.');
    this.activeGraph = graph;
    return graph;
  }
  graph(): E2eProgramAuthoringGraph {
    if (this.activeGraph === null) throw new Error('No E2E graph is active.');
    return this.activeGraph;
  }
  application(applicantId = E2E_STUDENT_ID): Promise<{
    readonly id: string;
    readonly status: ApplicationStatus;
  } | null> {
    const graph = this.graph();
    return this.prisma.team.findFirst({
      where: { programId: graph.programId, applicantId },
      select: { id: true, status: true },
    });
  }
  async state(capture: E2eExternalCapture): Promise<E2eProgramAuthoringState> {
    return stateForE2eProgramGraph(this.prisma, this.graph(), capture, [
      E2E_STAFF_ID,
      E2E_STUDENT_ID,
    ]);
  }
  private async ensureActors(): Promise<void> {
    await ensureE2eProgramAuthoringActors(this.prisma, {
      staffId: E2E_STAFF_ID,
      staffGithubId: E2E_STAFF_GITHUB_ID,
      studentId: E2E_STUDENT_ID,
      studentGithubId: E2E_STUDENT_GITHUB_ID,
      foreignStudentId: E2E_FOREIGN_STUDENT_ID,
      foreignStudentGithubId: E2E_FOREIGN_STUDENT_GITHUB_ID,
      prefix: PREFIX,
    });
  }
}
function fixtureGraph(): E2eProgramAuthoringGraph {
  return {
    programId: E2E_PROGRAM_ID,
    milestoneId: E2E_MILESTONE_ID,
    documentId: E2E_DOCUMENT_ID,
  };
}
