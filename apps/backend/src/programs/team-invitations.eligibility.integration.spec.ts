import { ApprovalStatus, DepartmentType, UserType } from '@prisma/client';
import { PlatformRepository } from '../platform/platform.repository';
import {
  AccountStatus,
  ProgramCategory,
  TeamInvitationStatus,
  ProgramTrackType,
} from '@prisma/client';
import { MemberKind } from '../users/user-contract.config';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../platform/prisma.service';
import { TeamInvitationsRepository } from './team-invitations.repository';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const DATABASE_CONNECTION_TIMEOUT_MS = 60_000;
const TEST_PREFIX = 'team-invitation-eligibility:';
const PROGRAM_ID = `${TEST_PREFIX}program`;
const TEAM_ID = `${TEST_PREFIX}team`;
const INVITATION_ID = `${TEST_PREFIX}invitation`;
const LEADER_ID = `${TEST_PREFIX}leader`;
const INVITEE_ID = `${TEST_PREFIX}invitee`;
const ACTIVE_STUDENT_ID = `${TEST_PREFIX}candidate-active-student`;
const STAFF_ID = `${TEST_PREFIX}candidate-staff`;
const ADMIN_ID = `${TEST_PREFIX}candidate-admin`;
const DEACTIVATED_STUDENT_ID = `${TEST_PREFIX}candidate-deactivated`;
const UNASSIGNED_ROLE_ID = `${TEST_PREFIX}candidate-unassigned`;
const CANDIDATE_QUERY = 'eligibility-candidate';
const RESPONDED_AT = new Date('2026-08-12T00:00:00.000Z');
const prisma = new PrismaService();
const repository = new TeamInvitationsRepository(
  prisma,
  new PlatformRepository(),
);

async function cleanup(): Promise<void> {
  await prisma.teamInvitation.deleteMany({
    where: { id: { startsWith: TEST_PREFIX } },
  });
  await prisma.teamMember.deleteMany({ where: { programId: PROGRAM_ID } });
  await prisma.team.deleteMany({ where: { programId: PROGRAM_ID } });
  await prisma.program.deleteMany({ where: { id: PROGRAM_ID } });
  await prisma.admin.deleteMany({
    where: { user: { id: { startsWith: TEST_PREFIX } } },
  });
  await prisma.user.deleteMany({
    where: { id: { startsWith: TEST_PREFIX } },
  });
}

async function seedEligibilityFixture(): Promise<void> {
  await Promise.all(
    [
      {
        id: LEADER_ID,
        githubId: 9_300_000_001n,
        nickname: 'eligibility-leader',
        accountStatus: AccountStatus.ACTIVE,
      },
      {
        id: INVITEE_ID,
        githubId: 9_300_000_002n,
        nickname: 'eligibility-invitee',
        accountStatus: AccountStatus.ACTIVE,
      },
      {
        id: ACTIVE_STUDENT_ID,
        githubId: 9_300_000_003n,
        nickname: `${CANDIDATE_QUERY}-student`,
        accountStatus: AccountStatus.ACTIVE,
      },
      {
        id: STAFF_ID,
        githubId: 9_300_000_004n,
        nickname: `${CANDIDATE_QUERY}-staff`,
        accountStatus: AccountStatus.ACTIVE,
        type: UserType.STAFF,
        approvalStatus: ApprovalStatus.APPROVED,
        name: 'Synthetic staff',
        department: 'Synthetic department',
        profileCreatedAt: new Date('2026-01-01T00:00:00.000Z'),
        profileUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
        departmentType: DepartmentType.DEPARTMENT,
      },
      {
        id: ADMIN_ID,
        githubId: 9_300_000_005n,
        nickname: `${CANDIDATE_QUERY}-admin`,
        accountStatus: AccountStatus.ACTIVE,
        ...{ admin: { create: { origin: 'MIGRATION' as const } } },
      },
      {
        id: DEACTIVATED_STUDENT_ID,
        githubId: 9_300_000_006n,
        nickname: `${CANDIDATE_QUERY}-deactivated`,
        accountStatus: AccountStatus.DEACTIVATED,
      },
      {
        id: UNASSIGNED_ROLE_ID,
        githubId: 9_300_000_007n,
        nickname: `${CANDIDATE_QUERY}-unassigned`,
        accountStatus: AccountStatus.ACTIVE,
      },
    ].map((data) => prisma.user.create({ data })),
  );
  await Promise.all(
    [
      {
        userId: LEADER_ID,
        name: 'Synthetic user',
        studentId: '303001',
        department: 'Synthetic department',
        type: MemberKind.STUDENT,
        departmentType: DepartmentType.DEPARTMENT,
        profileCreatedAt: new Date('2026-01-01T00:00:00.000Z'),
        profileUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        userId: INVITEE_ID,
        name: 'Synthetic user',
        studentId: '303002',
        department: 'Synthetic department',
        type: MemberKind.STUDENT,
        departmentType: DepartmentType.DEPARTMENT,
        profileCreatedAt: new Date('2026-01-01T00:00:00.000Z'),
        profileUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        userId: ACTIVE_STUDENT_ID,
        name: 'Synthetic user',
        studentId: '303003',
        department: 'Synthetic department',
        type: MemberKind.STUDENT,
        departmentType: DepartmentType.DEPARTMENT,
        profileCreatedAt: new Date('2026-01-01T00:00:00.000Z'),
        profileUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        userId: STAFF_ID,
        name: 'Synthetic user',
        studentId: null,
        department: 'Synthetic program office',
        type: MemberKind.STAFF,
        departmentType: DepartmentType.PROGRAM_OFFICE,
        profileCreatedAt: new Date('2026-01-01T00:00:00.000Z'),
        profileUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        userId: ADMIN_ID,
        approvalStatus: ApprovalStatus.PENDING,
        name: 'Synthetic user',
        studentId: null,
        department: 'Synthetic program office',
        type: MemberKind.STAFF,
        departmentType: DepartmentType.PROGRAM_OFFICE,
        profileCreatedAt: new Date('2026-01-01T00:00:00.000Z'),
        profileUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        userId: DEACTIVATED_STUDENT_ID,
        name: 'Synthetic user',
        studentId: '303006',
        department: 'Synthetic department',
        type: MemberKind.STUDENT,
        departmentType: DepartmentType.DEPARTMENT,
        profileCreatedAt: new Date('2026-01-01T00:00:00.000Z'),
        profileUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ].map(({ userId, ...profile }) =>
      prisma.user.update({ where: { id: userId }, data: profile }),
    ),
  );
  await prisma.program.create({
    data: {
      id: PROGRAM_ID,
      name: 'Invitation eligibility program',
      organizer: 'Synthetic organizer',
      trackType: ProgramTrackType.CURRICULAR,
      category: ProgramCategory.BASIC,
      applicationTemplateKey: 'capstone-v1',
      applicationTemplateVersion: 1,
      applicationStartAt: new Date('2026-08-01T00:00:00.000Z'),
      applicationEndAt: new Date('2026-08-31T00:00:00.000Z'),
      description: 'Synthetic invitation eligibility fixture',
      teamMinSize: 1,
      teamMaxSize: 4,
    },
  });
  await prisma.team.create({
    data: {
      id: TEAM_ID,
      programId: PROGRAM_ID,
      name: 'Eligibility team',
      joinCodeDigest: `${TEST_PREFIX}digest`,
      leaderId: LEADER_ID,
    },
  });
  await prisma.teamMember.create({
    data: {
      teamId: TEAM_ID,
      programId: PROGRAM_ID,
      userId: LEADER_ID,
    },
  });
  await prisma.teamInvitation.create({
    data: {
      id: INVITATION_ID,
      teamId: TEAM_ID,
      programId: PROGRAM_ID,
      inviteeId: INVITEE_ID,
      invitedById: LEADER_ID,
    },
  });
}

describe('TeamInvitationsRepository eligibility integration', () => {
  beforeAll(async () => {
    await prisma.$connect();
  }, DATABASE_CONNECTION_TIMEOUT_MS);

  beforeEach(async () => {
    await cleanup();
    await seedEligibilityFixture();
  });

  afterEach(cleanup);

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it('후보 검색에는 ACTIVE STUDENT만 노출한다', async () => {
    const candidates = await repository.searchCandidates(
      PROGRAM_ID,
      CANDIDATE_QUERY,
      LEADER_ID,
    );

    expect(candidates.map((candidate) => candidate.id)).toEqual([
      ACTIVE_STUDENT_ID,
    ]);
  });

  it.each([
    [
      '교직원으로 역할 변경',
      {
        type: MemberKind.STAFF,
        studentId: null,
        departmentType: DepartmentType.PROGRAM_OFFICE,
        department: 'Synthetic program office',
        approvalStatus: ApprovalStatus.APPROVED,
        name: 'Synthetic staff',
        profileCreatedAt: new Date('2026-01-01T00:00:00.000Z'),
        profileUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ],
    ['계정 비활성화', { accountStatus: AccountStatus.DEACTIVATED }],
  ] as const)('%s 후에는 기존 초대를 수락할 수 없다', async (_, update) => {
    await prisma.user.update({ where: { id: INVITEE_ID }, data: update });

    const outcome = await repository.withAcceptTransaction(
      INVITATION_ID,
      INVITEE_ID,
      RESPONDED_AT,
    );

    const [invitation, membership] = await Promise.all([
      prisma.teamInvitation.findUniqueOrThrow({
        where: { id: INVITATION_ID },
      }),
      prisma.teamMember.findUnique({
        where: {
          teamId_userId: { teamId: TEAM_ID, userId: INVITEE_ID },
        },
      }),
    ]);
    expect(outcome).toEqual({ kind: 'invitee-not-eligible' });
    expect(invitation.status).toBe(TeamInvitationStatus.PENDING);
    expect(invitation.respondedAt).toBeNull();
    expect(membership).toBeNull();
  });
});
