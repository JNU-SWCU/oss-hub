import { PlatformRepository } from '../platform/platform.repository';
import { ProgramTeamRepositoryEvidenceRepository } from './program-team-repository-evidence.repository';
import {
  AccountStatus,
  ApplicationStatus,
  RepositoryConnectionMode,
} from '@prisma/client';
import { MemberKind } from '../users/user-contract.config';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { TeamRepository } from './team.repository';
import { TeamHistoryRepository } from './team-history.repository';
import {
  prisma,
  service,
  resolver,
  githubId,
  programId,
  teamId,
  oldId,
  targetId,
  targetGithubId,
  input,
} from './student-repository-url.integration.fixture';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const staffGithubId = githubId + 1n;
const staffLogin = 'synthetic-relink-staff';
let staffId = '';

beforeAll(async () => {
  ({ id: staffId } = await prisma.user.create({
    data: {
      githubId: staffGithubId,
      nickname: staffLogin,
      type: MemberKind.STAFF,
      approvalStatus: 'APPROVED',
      name: 'Synthetic staff',
      department: 'Synthetic department',
      profileCreatedAt: new Date('2026-01-01T00:00:00.000Z'),
      profileUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
      departmentType: 'DEPARTMENT',
    },
    select: { id: true },
  }));
});
afterEach(async () => {
  await prisma.user.update({
    where: { id: staffId },
    data: { accountStatus: AccountStatus.ACTIVE },
  });
});

async function givenOtherTeam() {
  const other = {
    programId: `${programId}-other`,
    teamId: `${teamId}-other`,
  };
  await prisma.program.create({
    data: {
      startAt: new Date('2026-01-01'),
      endAt: new Date(new Date('2026-01-31').getTime() + 365 * 86400000),
      id: other.programId,
      name: 'Synthetic other program',
      organizer: 'Synthetic',
      category: 'BASIC',
      applicationTemplateKey: 'basic',
      applicationTemplateVersion: 1,
      applicationStartAt: new Date('2026-01-01'),
      applicationEndAt: new Date('2026-01-31'),
      description: 'Synthetic',
    },
  });
  await prisma.team.create({
    data: {
      id: other.teamId,
      programId: other.programId,
      name: 'Synthetic other team',
      leaderId: staffId,
      applicantId: staffId,
      answers: { title: 'Synthetic other team' },
      applicationTemplateVersion: 1,
    },
  });
  await prisma.team.update({
    where: { id: other.teamId },
    data: {
      programId: other.programId,
      applicantId: staffId,
      status: ApplicationStatus.APPROVED,
      answers: {},
      applicationTemplateVersion: 1,
    },
  });
  return other;
}

async function expectCurrentLinkKept() {
  expect(
    await prisma.githubRepository.findUnique({ where: { id: oldId } }),
  ).toMatchObject({ teamId });
  expect(
    await prisma.teamHistory.count({
      where: { teamId, event: 'REPOSITORY_URL_CHANGED' },
    }),
  ).toBe(0);
}

it('saves a staff link on a provisioning-off program and shows it in the staff history', async () => {
  await prisma.program.update({
    where: { id: programId },
    data: { repositoryProvisioningEnabled: false },
  });

  await expect(
    service.updateForTeam(staffGithubId, programId, teamId, input),
  ).resolves.toEqual({
    repositoryUrl: input.repositoryUrl,
    canEditRepositoryUrl: true,
  });

  expect(
    await prisma.githubRepository.findUnique({ where: { id: targetId } }),
  ).toMatchObject({ teamId });
  expect(await prisma.team.findUnique({ where: { id: teamId } })).toMatchObject(
    {
      repositoryConnectionMode: RepositoryConnectionMode.OWN,
      repositoryUrl: input.repositoryUrl,
    },
  );
  await expect(
    prisma.teamHistory.findFirstOrThrow({
      where: { teamId, event: 'REPOSITORY_URL_CHANGED' },
    }),
  ).resolves.toMatchObject({
    actorId: staffId,
    event: 'REPOSITORY_URL_CHANGED',
  });
  const history = await new TeamRepository(
    prisma,
    new ProgramTeamRepositoryEvidenceRepository(prisma),
    new PlatformRepository(),
    new TeamHistoryRepository(),
  ).findStaffRepositoryUrlHistory(programId, teamId);
  expect(history?.rows).toMatchObject([
    {
      metadata: {
        actorGithubLogin: staffLogin,
        before: { repositoryUrl: 'https://github.com/synthetic/old' },
        after: { repositoryUrl: input.repositoryUrl },
      },
    },
  ]);
});

it('lets the current leader use the same team route', async () => {
  await service.updateForTeam(githubId, programId, teamId, input);
  expect(
    await prisma.githubRepository.findUnique({ where: { id: targetId } }),
  ).toMatchObject({ teamId });
});

it('rejects a repository owned by another application without detaching A', async () => {
  const other = await givenOtherTeam();
  await prisma.githubRepository.update({
    where: { id: targetId },
    data: {
      teamId: other.teamId,
    },
  });
  await expect(
    service.updateForTeam(staffGithubId, programId, teamId, input),
  ).rejects.toMatchObject({ errorCode: { code: 'APP_029' } });
  await expectCurrentLinkKept();
  expect(
    await prisma.githubRepository.findUnique({ where: { id: targetId } }),
  ).toMatchObject({ teamId: other.teamId });
});

it('rejects a detached repository carrying another team history without changing it', async () => {
  const other = await givenOtherTeam();
  const carried = await prisma.githubRepository.update({
    where: { id: targetId },
    data: { teamId: other.teamId },
  });
  await expect(
    service.updateForTeam(staffGithubId, programId, teamId, input),
  ).rejects.toMatchObject({ errorCode: { code: 'APP_029' } });
  await expectCurrentLinkKept();
  expect(
    await prisma.githubRepository.findUnique({ where: { id: targetId } }),
  ).toEqual(carried);
});

it('rolls back a staff link when the team history write fails', async () => {
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "TeamHistory" ADD CONSTRAINT "todo9_url_history_failure" CHECK (event <> 'REPOSITORY_URL_CHANGED') NOT VALID`,
  );
  try {
    await expect(
      service.updateForTeam(staffGithubId, programId, teamId, input),
    ).rejects.toThrow('todo9_url_history_failure');
  } finally {
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "TeamHistory" DROP CONSTRAINT "todo9_url_history_failure"',
    );
  }
  await expectCurrentLinkKept();
  expect(
    await prisma.githubRepository.findUnique({ where: { id: targetId } }),
  ).toMatchObject({ teamId: null, presence: 'ABSENT', failureCount: 4 });
  expect(await prisma.team.findUnique({ where: { id: teamId } })).toMatchObject(
    {
      repositoryConnectionMode: RepositoryConnectionMode.NEW,
      repositoryUrl: null,
    },
  );
});

it('answers a non-leader member with 404 before GitHub', async () => {
  const successor = await prisma.user.create({
    data: { githubId: targetGithubId + 5n, nickname: 'synthetic-successor' },
  });
  await prisma.teamMember.create({
    data: { teamId, programId, userId: successor.id },
  });
  await prisma.team.update({
    where: { id: teamId },
    data: { leaderId: successor.id },
  });
  resolver.resolve.mockClear();
  await expect(
    service.updateForTeam(githubId, programId, teamId, input),
  ).rejects.toMatchObject({ errorCode: { code: 'APP_001' } });
  expect(resolver.resolve).not.toHaveBeenCalled();
  await expectCurrentLinkKept();
});

it.each([
  [
    'a deactivated staff account',
    async () => {
      await prisma.user.update({
        where: { id: staffId },
        data: { accountStatus: AccountStatus.DEACTIVATED },
      });
      return teamId;
    },
  ],
  ['a team of another program', async () => (await givenOtherTeam()).teamId],
  ['a missing team', () => Promise.resolve(`${teamId}-missing`)],
])('answers %s with 404 before GitHub', async (_label, arrange) => {
  const target = await arrange();
  resolver.resolve.mockClear();
  await expect(
    service.updateForTeam(staffGithubId, programId, target, input),
  ).rejects.toMatchObject({ errorCode: { code: 'APP_001' } });
  expect(resolver.resolve).not.toHaveBeenCalled();
  await expectCurrentLinkKept();
});

it('closes staff edits after the program ends', async () => {
  await prisma.program.update({
    where: { id: programId },
    data: { endAt: new Date('2026-02-01') },
  });
  resolver.resolve.mockClear();
  await expect(
    service.updateForTeam(staffGithubId, programId, teamId, input),
  ).rejects.toMatchObject({ errorCode: { code: 'APP_028' } });
  expect(resolver.resolve).not.toHaveBeenCalled();
  await expectCurrentLinkKept();
});
