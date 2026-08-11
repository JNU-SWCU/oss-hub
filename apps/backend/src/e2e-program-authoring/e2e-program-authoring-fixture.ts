import {
  AccountStatus,
  ApplicationStatus,
  MilestoneSubmissionType,
  ProgramCategory,
  ProgramLifecycle,
  Role,
} from '@prisma/client';
import { stateForE2eProgramGraph } from './e2e-program-authoring-state';
import { removeAdoptedGraph } from './e2e-program-authoring-graph-cleanup';
import { adoptE2eProgramGraph } from './e2e-program-authoring-graph-adoption';
import { ensureE2eProgramAuthoringActors } from './e2e-program-authoring-actors';
import type { E2eExternalCapture } from './e2e-external-port-registry';
import type {
  E2eProgramAuthoringGraph,
  E2eProgramAuthoringState,
} from './e2e-program-authoring.types';
import { PrismaService } from '../prisma/prisma.service';
import { CONSENT_POLICY_VERSION } from '../consents/consents.service';

const PREFIX = 'e2e:program-authoring:';
export const E2E_PROGRAM_ID = `${PREFIX}program`;
export const E2E_STAFF_ID = `${PREFIX}staff`;
export const E2E_STUDENT_ID = `${PREFIX}student`;
export const E2E_FOREIGN_STUDENT_ID = `${PREFIX}foreign-student`;
export const E2E_MILESTONE_ID = `${PREFIX}milestone`;
export const E2E_DOCUMENT_ID = `${PREFIX}document`;
export const E2E_STAFF_GITHUB_ID = 8_100_001n;
export const E2E_STUDENT_GITHUB_ID = 8_100_002n;
export const E2E_FOREIGN_STUDENT_GITHUB_ID = 8_100_003n;
const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;
// 캘린더에 고정된 날짜 대신 프로세스 기동 시점(실행 시점 벽시계) 기준 +2시간을 고정 앵커로 삼는다 —
// 실제 UI 상호작용이 끝날 때까지 신청 기간이 실행 중 닫히지 않을 만큼만 여유를 두고, 마감 알림
// 대상 판정 창(deadlineWindow, `실행 시점~+24시간`)에 마일스톤 마감(앵커+9시간)이 들어오게 한다.
export const E2E_NOW = new Date(Date.now() + 2 * ONE_HOUR_MS);

export class E2eProgramAuthoringFixture {
  private activeGraph: E2eProgramAuthoringGraph | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async reset(): Promise<void> {
    if (
      this.activeGraph !== null &&
      this.activeGraph.programId !== E2E_PROGRAM_ID
    ) {
      await removeAdoptedGraph(this.prisma, this.activeGraph, PREFIX);
      this.activeGraph = null;
    }
    await this.prisma.$transaction(async (transaction) => {
      const applications = await transaction.application.findMany({
        where: { programId: E2E_PROGRAM_ID },
        select: { id: true },
      });
      const applicationIds = applications.map(({ id }) => id);
      await transaction.notification.deleteMany({
        where: { userId: { in: [E2E_STAFF_ID, E2E_STUDENT_ID] } },
      });
      await transaction.outboxEvent.deleteMany({
        where: { aggregateId: { in: applicationIds } },
      });
      await transaction.repositoryProvisionJob.deleteMany({
        where: { applicationId: { in: applicationIds } },
      });
      await transaction.repositoryInvitation.deleteMany({
        where: { repository: { applicationId: { in: applicationIds } } },
      });
      await transaction.repository.deleteMany({
        where: { applicationId: { in: applicationIds } },
      });
      await transaction.submissionFile.deleteMany({
        where: { applicationId: { in: applicationIds } },
      });
      await transaction.milestoneDocumentSubmission.deleteMany({
        where: { applicationId: { in: applicationIds } },
      });
      await transaction.application.deleteMany({
        where: { id: { in: applicationIds } },
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
      await transaction.milestoneDocumentTemplateFile.deleteMany({
        where: { milestoneDocumentId: E2E_DOCUMENT_ID },
      });
      await transaction.milestoneDocument.deleteMany({
        where: { id: E2E_DOCUMENT_ID },
      });
      await transaction.milestone.deleteMany({
        where: { id: E2E_MILESTONE_ID },
      });
      await transaction.programAuthoringUpload.deleteMany({
        where: { actorId: E2E_STAFF_ID },
      });
      await transaction.program.deleteMany({ where: { id: E2E_PROGRAM_ID } });
    });
    this.activeGraph = null;
  }

  async ensure(): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.user.upsert({
        where: { id: E2E_STAFF_ID },
        create: {
          id: E2E_STAFF_ID,
          githubId: E2E_STAFF_GITHUB_ID,
          nickname: 'e2e-program-authoring-staff',
          // isCompleteProfileFields(user-profile-policy.ts REQUIREMENT_BY_ROLE)는
          // STAFF에게 name과 department를 요구한다(studentId만 면제) — 비워 두면
          // RoleGate가 staffPage를 프로필 미완료로 보고 /onboarding/profile로
          // 되돌리려 해, 이 화면 진입이 "확인 중…"에 갇힌다.
          name: 'E2E Staff',
          department: 'E2E Department',
          accountStatus: AccountStatus.ACTIVE,
          role: Role.STAFF,
        },
        update: {
          nickname: 'e2e-program-authoring-staff',
          name: 'E2E Staff',
          department: 'E2E Department',
          accountStatus: AccountStatus.ACTIVE,
          role: Role.STAFF,
        },
      });
      await transaction.user.upsert({
        where: { id: E2E_STUDENT_ID },
        create: {
          id: E2E_STUDENT_ID,
          githubId: E2E_STUDENT_GITHUB_ID,
          nickname: 'e2e-program-authoring-student',
          name: 'E2E Student',
          studentId: '20260001',
          department: 'E2E Department',
          notificationEmail: 'e2e-program-authoring-student@fixture.invalid',
          notifyEnabled: true,
          accountStatus: AccountStatus.ACTIVE,
          role: Role.STUDENT,
        },
        update: {
          nickname: 'e2e-program-authoring-student',
          name: 'E2E Student',
          studentId: '20260001',
          department: 'E2E Department',
          notificationEmail: 'e2e-program-authoring-student@fixture.invalid',
          notifyEnabled: true,
          accountStatus: AccountStatus.ACTIVE,
        },
      });
      await transaction.user.upsert({
        where: { id: E2E_FOREIGN_STUDENT_ID },
        create: {
          id: E2E_FOREIGN_STUDENT_ID,
          githubId: E2E_FOREIGN_STUDENT_GITHUB_ID,
          nickname: 'e2e-program-authoring-foreign-student',
          name: 'E2E Foreign Student',
          studentId: '20260002',
          department: 'E2E Department',
          notificationEmail:
            'e2e-program-authoring-foreign-student@fixture.invalid',
          notifyEnabled: true,
          accountStatus: AccountStatus.ACTIVE,
          role: Role.STUDENT,
        },
        update: {
          nickname: 'e2e-program-authoring-foreign-student',
          name: 'E2E Foreign Student',
          studentId: '20260002',
          department: 'E2E Department',
          notificationEmail:
            'e2e-program-authoring-foreign-student@fixture.invalid',
          notifyEnabled: true,
          accountStatus: AccountStatus.ACTIVE,
        },
      });
      await transaction.consent.createMany({
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
          submissionType: MilestoneSubmissionType.FILE,
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
          submissionType: MilestoneSubmissionType.FILE,
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
    this.activeGraph = graph;
    return graph;
  }

  graph(): E2eProgramAuthoringGraph {
    if (this.activeGraph === null) throw new Error('No E2E graph is active.');
    return this.activeGraph;
  }

  application(): Promise<{
    readonly id: string;
    readonly status: ApplicationStatus;
  } | null> {
    const graph = this.graph();
    return this.prisma.application.findFirst({
      where: { programId: graph.programId, applicantId: E2E_STUDENT_ID },
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
