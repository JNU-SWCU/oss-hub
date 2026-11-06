import { PlatformRepository } from '../platform/platform.repository';
import { MilestoneDocumentFeedbackResponseDto } from './dto/milestone-document-feedback-response.dto';
import {
  ApplicationStatus,
  ProgramCategory,
  ReviewDecision,
} from '@prisma/client';
import { MemberKind } from '../users/user-contract.config';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../platform/prisma.service';
import { MilestoneDocumentFeedbackService } from './milestone-document-feedback.service';
import { MilestoneDocumentFeedbackRepository } from './milestone-document-feedback.repository';
assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});
const prefix = 'dashboard-feedback';
const studentGithubId = 9600000000995001n;
const users = {
  student: `${prefix}-student`,
  other: `${prefix}-other`,
  staff: `${prefix}-staff`,
} as const;
const milestoneName = '합성 중간 보고';
const now = new Date('2026-09-20T03:00:00.000Z');
const prisma = new PrismaService();
const service = new MilestoneDocumentFeedbackService(
  new MilestoneDocumentFeedbackRepository(prisma, new PlatformRepository()),
  () => now,
);
async function cleanup(): Promise<void> {
  const owned = { startsWith: prefix };
  await prisma.submissionHistory.deleteMany({
    where: { id: owned },
  });
  await prisma.submission.deleteMany({ where: { id: owned } });
  await prisma.teamMember.deleteMany({ where: { teamId: owned } });
  await prisma.team.deleteMany({ where: { id: owned } });
  await prisma.requirement.deleteMany({ where: { id: owned } });
  await prisma.milestone.deleteMany({ where: { id: owned } });
  await prisma.program.deleteMany({ where: { id: owned } });
  await prisma.user.deleteMany({ where: { id: owned } });
}
async function createProgram(key: string, name: string): Promise<void> {
  await prisma.program.create({
    data: {
      startAt: new Date('2026-01-01'),
      endAt: new Date(new Date('2026-01-02').getTime() + 365 * 86400000),
      id: `${prefix}-${key}-program`,
      name,
      organizer: 'OSS Hub',
      category: ProgramCategory.BASIC,
      applicationTemplateKey: 'capstone-v1',
      applicationTemplateVersion: 1,
      applicationStartAt: new Date('2026-01-01'),
      applicationEndAt: new Date('2026-01-02'),
      description: 'synthetic dashboard feedback fixture',
      milestones: {
        create: {
          startAt: new Date('2026-01-01'),
          id: `${prefix}-${key}-milestone`,
          name: milestoneName,
          dueAt: new Date('2026-12-31'),
          requirements: {
            create: [
              {
                id: `${prefix}-${key}-document`,
                name: '합성 계획서',
                required: true,
                sortOrder: 1,
              },
              {
                id: `${prefix}-${key}-legacy`,
                name: '이관 당시 마일스톤 이름',
                required: true,
                sortOrder: -1,
              },
            ],
          },
        },
      },
    },
  });
}
async function createApplication(input: {
  readonly key: string;
  readonly program: string;
  readonly applicant: string;
  readonly members: readonly string[];
  readonly status: ApplicationStatus;
}): Promise<void> {
  const programId = `${prefix}-${input.program}-program`;
  const teamId = `${prefix}-${input.key}-team`;
  await prisma.team.create({
    data: {
      id: teamId,
      programId,
      name: `합성 ${input.key} 팀`,
      leaderId: input.members[0] ?? input.applicant,
      applicantId: input.members[0] ?? input.applicant,
      answers: { title: `합성 ${input.key} 팀` },
      applicationTemplateVersion: 1,
    },
  });
  for (const userId of input.members) {
    await prisma.teamMember.create({
      data: { teamId, programId, userId },
    });
  }
  await prisma.team.update({
    where: { id: teamId },
    data: {
      programId,
      applicantId: input.applicant,
      answers: { syntheticFixture: true },
      applicationTemplateVersion: 1,
      status: input.status,
    },
  });
}
async function createReviews(input: {
  readonly application: string;
  readonly document: string;
  readonly reviews: readonly {
    readonly key: string;
    readonly reviewedAt: string;
    readonly decision?: ReviewDecision;
  }[];
}): Promise<void> {
  const submissionId = `${prefix}-${input.application}-${input.document}-submission`;
  await prisma.submission.create({
    data: {
      id: submissionId,
      requirementId: input.document,
      teamId: `${prefix}-${input.application}-team`,
      submittedById: users.student,
    },
  });
  await prisma.submissionHistory.createMany({
    data: input.reviews.map((review) => ({
      id: `${prefix}-review-${review.key}`,
      submissionId,
      actorId: users.staff,
      event: review.decision ?? ReviewDecision.CHANGES_REQUESTED,
      revision: 1,
      comment: `합성 의견 ${review.key}`,
      createdAt: new Date(review.reviewedAt),
    })),
  });
}
describe('학생 대시보드 최근 피드백 — 실제 판정 이력 조회', () => {
  beforeAll(async () => {
    await prisma.$connect();
    await cleanup();
    await prisma.user.createMany({
      data: [
        {
          id: users.student,
          githubId: studentGithubId,
          nickname: users.student,
          type: MemberKind.STUDENT,
          approvalStatus: 'NOT_REQUIRED',
        },
        {
          id: users.other,
          githubId: studentGithubId + 1n,
          nickname: users.other,
          type: MemberKind.STUDENT,
          approvalStatus: 'NOT_REQUIRED',
        },
        {
          id: users.staff,
          githubId: studentGithubId + 2n,
          nickname: users.staff,
          type: 'STAFF',
          approvalStatus: 'APPROVED',
          name: 'Synthetic staff',
          department: 'Synthetic department',
          profileCreatedAt: new Date('2026-01-01T00:00:00.000Z'),
          profileUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
          departmentType: 'DEPARTMENT',
        },
      ],
    });
    await createProgram('main', '합성 피드백 프로그램');
    await createProgram('second', '합성 두 번째 프로그램');
    await createProgram('pending', '합성 심사 중 프로그램');
    await createProgram('left', '합성 탈퇴 프로그램');
    await createApplication({
      key: 'mine',
      program: 'main',
      applicant: users.student,
      members: [users.student],
      status: ApplicationStatus.APPROVED,
    });
    await createApplication({
      key: 'second',
      program: 'second',
      applicant: users.student,
      members: [users.student],
      status: ApplicationStatus.APPROVED,
    });
    await createApplication({
      key: 'others',
      program: 'main',
      applicant: users.other,
      members: [users.other],
      status: ApplicationStatus.APPROVED,
    });
    await createApplication({
      key: 'pending',
      program: 'pending',
      applicant: users.student,
      members: [users.student],
      status: ApplicationStatus.SUBMITTED,
    });
    await createApplication({
      key: 'left',
      program: 'left',
      applicant: users.student,
      members: [users.other],
      status: ApplicationStatus.APPROVED,
    });
    await createReviews({
      application: 'mine',
      document: `${prefix}-main-document`,
      reviews: [
        { key: 'window-start', reviewedAt: '2026-09-12T15:00:00.000Z' },
        { key: 'before-window', reviewedAt: '2026-09-12T14:59:59.999Z' },
        ...[1, 2, 3, 4, 5].map((minute) => ({
          key: `document-${minute}`,
          reviewedAt: `2026-09-20T00:0${minute}:00.000Z`,
        })),
      ],
    });
    await createReviews({
      application: 'mine',
      document: `${prefix}-main-legacy`,
      reviews: [
        {
          key: 'legacy',
          reviewedAt: '2026-09-20T00:06:00.000Z',
          decision: ReviewDecision.APPROVED,
        },
      ],
    });
    await createReviews({
      application: 'second',
      document: `${prefix}-second-document`,
      reviews: [{ key: 'second', reviewedAt: '2026-09-19T00:00:00.000Z' }],
    });
    await createReviews({
      application: 'others',
      document: `${prefix}-main-document`,
      reviews: [{ key: 'other-team', reviewedAt: '2026-09-20T00:07:00.000Z' }],
    });
    await createReviews({
      application: 'pending',
      document: `${prefix}-pending-document`,
      reviews: [
        { key: 'not-approved', reviewedAt: '2026-09-20T00:08:00.000Z' },
      ],
    });
    await createReviews({
      application: 'left',
      document: `${prefix}-left-document`,
      reviews: [
        { key: 'former-member', reviewedAt: '2026-09-20T00:09:00.000Z' },
      ],
    });
  });
  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });
  it('지금 팀원인 승인 신청의 판정 중 서울 날짜로 7일 전 0시 이후 것을 모두 최신순으로 돌려준다', async () => {
    const { items } = await service
      .recentForParticipant(studentGithubId)
      .then((result) => MilestoneDocumentFeedbackResponseDto.from(result));
    expect(items.map((item) => item.id)).toEqual([
      `${prefix}-review-legacy`,
      `${prefix}-review-document-5`,
      `${prefix}-review-document-4`,
      `${prefix}-review-document-3`,
      `${prefix}-review-document-2`,
      `${prefix}-review-document-1`,
      `${prefix}-review-second`,
      `${prefix}-review-window-start`,
    ]);
  });
  it('판정마다 그 판정을 받은 신청 ID를 실어 프로그램 카드에 나눠 붙일 수 있게 한다', async () => {
    const { items } = await service
      .recentForParticipant(studentGithubId)
      .then((result) => MilestoneDocumentFeedbackResponseDto.from(result));
    const teamIdOf = new Map(items.map((item) => [item.id, item.teamId]));

    expect(teamIdOf.get(`${prefix}-review-document-1`)).toBe(
      `${prefix}-mine-team`,
    );
    expect(teamIdOf.get(`${prefix}-review-second`)).toBe(
      `${prefix}-second-team`,
    );
  });
  it('이관한 항목도 항목 이름으로 부르고 검토자를 싣지 않는다', async () => {
    const { items } = await service
      .recentForParticipant(studentGithubId)
      .then((result) => MilestoneDocumentFeedbackResponseDto.from(result));
    const href = `/programs/${prefix}-main-program/documents?milestoneId=${prefix}-main-milestone`;
    expect(items[0]).toEqual({
      id: `${prefix}-review-legacy`,
      decision: ReviewDecision.APPROVED,
      comment: '합성 의견 legacy',
      reviewedAt: '2026-09-20T00:06:00.000Z',
      teamId: `${prefix}-mine-team`,
      programId: `${prefix}-main-program`,
      milestoneId: `${prefix}-main-milestone`,
      milestoneName,
      itemName: '이관 당시 마일스톤 이름',
      href,
    });
    expect(items[1]).toMatchObject({ itemName: '합성 계획서', href });
  });
});
