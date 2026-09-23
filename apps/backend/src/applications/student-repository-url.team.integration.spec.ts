import {
  AccountStatus,
  ApplicationStatus,
  MemberKind,
  RepositoryConnectionMode,
} from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { ProgramTeamsRepository } from '../programs/repository/program-teams.repository';
import {
  prisma,
  service,
  audit,
  resolver,
  githubId,
  programId,
  applicationId,
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
      selectedMemberKind: MemberKind.STAFF,
      hasStaffAccess: true,
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
    applicationId: `${applicationId}-other`,
  };
  await prisma.program.create({
    data: {
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
      joinCodeDigest: `${other.teamId}-digest`,
      leaderId: staffId,
    },
  });
  await prisma.application.create({
    data: {
      id: other.applicationId,
      programId: other.programId,
      teamId: other.teamId,
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
  ).toMatchObject({ applicationId });
  expect(
    await prisma.auditLog.count({ where: { targetId: applicationId } }),
  ).toBe(0);
}

it('saves a staff link on a provisioning-off program and shows it in the staff history', async () => {
  // Given: 발급이 꺼진 프로그램이고 교직원은 그 팀의 구성원이 아니다.
  await prisma.program.update({
    where: { id: programId },
    data: { repositoryProvisioningEnabled: false },
  });
  // When
  await expect(
    service.updateForTeam(staffGithubId, programId, teamId, input),
  ).resolves.toEqual({
    repositoryUrl: input.repositoryUrl,
    canEditRepositoryUrl: true,
  });
  // Then: 연결은 바뀌고, 교직원 이력 화면이 읽는 원장에 교직원 login으로 남는다.
  expect(
    await prisma.githubRepository.findUnique({ where: { id: targetId } }),
  ).toMatchObject({ applicationId, programId, teamId });
  await expect(
    prisma.auditLog.findFirstOrThrow({ where: { targetId: applicationId } }),
  ).resolves.toMatchObject({
    actorId: staffId,
    action: 'APPLICATION_REPOSITORY_URL_CHANGED',
  });
  const history = await new ProgramTeamsRepository(
    prisma,
  ).findStaffRepositoryUrlHistory(programId, teamId);
  expect(history?.items).toMatchObject([
    {
      actorGithubLogin: staffLogin,
      previousRepositoryUrl: 'https://github.com/synthetic/old',
      newRepositoryUrl: input.repositoryUrl,
    },
  ]);
});

it('lets the current leader use the same team route', async () => {
  await service.updateForTeam(githubId, programId, teamId, input);
  expect(
    await prisma.githubRepository.findUnique({ where: { id: targetId } }),
  ).toMatchObject({ applicationId });
});

it('rejects a repository owned by another application without detaching A', async () => {
  const other = await givenOtherTeam();
  await prisma.githubRepository.update({
    where: { id: targetId },
    data: {
      applicationId: other.applicationId,
      programId: other.programId,
      teamId: other.teamId,
    },
  });
  await expect(
    service.updateForTeam(staffGithubId, programId, teamId, input),
  ).rejects.toMatchObject({ errorCode: { code: 'APP_029' } });
  await expectCurrentLinkKept();
  expect(
    await prisma.githubRepository.findUnique({ where: { id: targetId } }),
  ).toMatchObject({ applicationId: other.applicationId });
});

it('rejects a detached repository carrying another team history without changing it', async () => {
  const other = await givenOtherTeam();
  const carried = await prisma.githubRepository.update({
    where: { id: targetId },
    data: { programId: other.programId, teamId: other.teamId },
  });
  await expect(
    service.updateForTeam(staffGithubId, programId, teamId, input),
  ).rejects.toMatchObject({ errorCode: { code: 'APP_029' } });
  await expectCurrentLinkKept();
  expect(
    await prisma.githubRepository.findUnique({ where: { id: targetId } }),
  ).toEqual(carried);
});

it('rolls back a staff link when the audit write fails', async () => {
  jest
    .spyOn(audit, 'record')
    .mockRejectedValue(new Error('Synthetic audit outage'));
  await expect(
    service.updateForTeam(staffGithubId, programId, teamId, input),
  ).rejects.toThrow('Synthetic audit outage');
  await expectCurrentLinkKept();
  expect(
    await prisma.githubRepository.findUnique({ where: { id: targetId } }),
  ).toMatchObject({ applicationId: null, presence: 'ABSENT', failureCount: 4 });
  expect(
    await prisma.application.findUnique({ where: { id: applicationId } }),
  ).toMatchObject({
    repositoryConnectionMode: RepositoryConnectionMode.NEW,
    repositoryUrl: null,
  });
});

it('answers a non-leader member with 404 before GitHub', async () => {
  // Given: 픽스처 학생은 팀에 남고 팀장만 다른 사람에게 넘어갔다.
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
  [
    'a team without an application',
    async () => {
      const lonely = `${teamId}-lonely`;
      await prisma.team.create({
        data: {
          id: lonely,
          programId,
          name: 'Synthetic lonely team',
          joinCodeDigest: `${lonely}-digest`,
          leaderId: staffId,
        },
      });
      return lonely;
    },
  ],
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
