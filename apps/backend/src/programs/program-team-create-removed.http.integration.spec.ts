import { TeamHistoryRepository } from './team-history.repository';
import { AuditLogReadService } from '../platform/audit-log-read.service';
import { StudentRepositoryUrlService } from './team-application.service';
import { PlatformRepository } from '../platform/platform.repository';
import { PrismaSerializationRetryRepository } from '../platform/prisma-serialization-retry.repository';
import { TeamDeletionScopeRepository } from './team.repository';
import { ProgramTeamRepositoryEvidenceRepository } from './program-team-repository-evidence.repository';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { ProgramsModule } from './programs.module';
import { Test } from '@nestjs/testing';
import { ProgramCategory } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { AuditLogRepository } from '../platform/audit-log.repository';
import { AuditLogService } from '../platform/audit-log.service';
import { AuthConfig } from '../platform/auth.config';
import { OriginGuard } from '../platform/origin.guard';
import { AuthService } from '../auth/auth.service';
import { ProblemDetailFilter } from '../platform/problem-detail.filter';
import { PrismaService } from '../platform/prisma.service';
import { canonicalUserCreateFromLabel } from '../users/canonical-user-fixture';
import { ProgramTeamDeletionRepository } from './team.repository';
import { TeamRepository } from './team.repository';
import { TeamMembershipService } from './team-membership.service';
import { TeamsController, ProgramApplicationsController, StudentApplicationsController, ApplicationsController } from './teams.controller';
import { TeamApplicationService, ApplicationAnswersService, StudentApplicationManagementService } from './team-application.service';
import { ApplicationsRepository, StudentApplicationManagementRepository } from './team.repository';
import { RepositoryProvisionGenerationRepository } from '../platform/repository-provision-generation.repository';
import { RepositoryProvisionEventService } from '../github/repository-provision-event.service';
import { AuditLogMetadataService } from '../platform/audit-log-metadata.service';
import { AuthSessionService } from '../platform/auth-session.service';
import { RepositoryPublishService } from '../github/repository-publish.service';
import { RepositoryUrlService } from '../github/repository-url.service';
import { MilestoneCompletionService } from './milestone-completion.service';
import { GLOBAL_AUTHENTICATION_GUARD_PROVIDERS, databaseSessionPrincipal } from '../../test/global-authentication-guard.fixture';

const authSessionService = new AuthSessionService();

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
const prefix = 'synthetic-removed-team-create:';
const programId = `${prefix}program`;
const userId = `${prefix}student`;
const githubId = 8_602_100_001n;
const allowedOrigin = 'http://frontend.test';
const sessionSecret = new Uint8Array(32).fill(13);
let application: INestApplication;
let baseUrl: string;
let cookie: string;

async function cleanup(): Promise<void> {
  await prisma.notification.deleteMany({ where: { userId: { startsWith: prefix } } });
  await prisma.milestoneDocumentSubmission.deleteMany({ where: { team: { programId } } });
  await prisma.milestoneDocument.deleteMany({ where: { milestone: { programId } } });
  await prisma.milestone.deleteMany({ where: { programId } });
  await prisma.teamHistory.deleteMany({ where: { programId } });
  await prisma.teamMember.deleteMany({ where: { programId } });
  await prisma.team.deleteMany({ where: { programId } });
  await prisma.program.deleteMany({ where: { id: programId } });
}

beforeAll(async () => {
  await prisma.$connect();
  const service = new TeamMembershipService(new TeamRepository(prisma, new ProgramTeamRepositoryEvidenceRepository(prisma), new PlatformRepository(), new TeamHistoryRepository()), new ProgramTeamDeletionRepository(new TeamHistoryRepository(), prisma, new TeamDeletionScopeRepository(), new PrismaSerializationRetryRepository()), new AuditLogMetadataService(), new RepositoryPublishService(), new RepositoryUrlService(), new MilestoneCompletionService(), new StudentRepositoryUrlService({} as never, {} as never, {} as never, {} as never, {} as never, {} as never));
  const repository = new ApplicationsRepository(prisma, new TeamHistoryRepository(), new RepositoryProvisionGenerationRepository(), new PlatformRepository());
  const teamApplication = new TeamApplicationService(repository, new RepositoryUrlService(), new ApplicationAnswersService(), new RepositoryProvisionEventService());
  const studentApplication = new StudentApplicationManagementService(new StudentApplicationManagementRepository(prisma, new TeamHistoryRepository(), new PlatformRepository()), repository, new ApplicationAnswersService());
  const productionControllers: unknown = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, ProgramsModule);
  if (!Array.isArray(productionControllers)) throw new TypeError('ProgramsModule controllers are missing');
  const controllers = productionControllers.filter((controller: unknown): controller is typeof TeamsController | typeof ProgramApplicationsController | typeof StudentApplicationsController | typeof ApplicationsController => controller === TeamsController || controller === ProgramApplicationsController || controller === StudentApplicationsController || controller === ApplicationsController);
  const moduleRef = await Test.createTestingModule({
    controllers,
    providers: [
      { provide: TeamMembershipService, useValue: service },
      { provide: TeamApplicationService, useValue: teamApplication },
      { provide: StudentApplicationManagementService, useValue: studentApplication },
      AuthSessionService,
      ...GLOBAL_AUTHENTICATION_GUARD_PROVIDERS,
      OriginGuard,
      {
        provide: AuthService,
        useValue: {
          getMe: (actorGithubId: bigint) => databaseSessionPrincipal(prisma, actorGithubId),
        },
      },
      {
        provide: AuthConfig,
        useValue: { sessionSecret, allowedOrigin, useSecureCookies: false },
      },
    ],
  }).compile();
  application = moduleRef.createNestApplication();
  application.setGlobalPrefix('api/v1');
  application.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  application.useGlobalFilters(new ProblemDetailFilter());
  await application.listen(0, '127.0.0.1');
  baseUrl = await application.getUrl();
  cookie = `${authSessionService.sessionCookieName(false)}=${await authSessionService.issueSessionToken(sessionSecret, githubId, 0)}`;
});

beforeEach(async () => {
  await cleanup();
  await prisma.user.upsert({
    where: { id: userId },
    update: {},
    create: canonicalUserCreateFromLabel('STUDENT', {
        id: userId,
        githubId,
        nickname: 'synthetic-team-create-student',
    })
});
  await prisma.program.create({
    data: {
        startAt: new Date('2000-01-01'),
        endAt: new Date(new Date('2099-12-31').getTime() + 365 * 86400000),
        id: programId,
        name: 'Synthetic open program',
        organizer: 'Synthetic organizer',
        category: ProgramCategory.BASIC,
        applicationTemplateKey: 'basic',
        applicationTemplateVersion: 1,
        applicationStartAt: new Date('2000-01-01'),
        applicationEndAt: new Date('2099-12-31'),
        description: 'Synthetic fixture',
        teamMinSize: 1,
        teamMaxSize: 3
    }
});
});

afterAll(async () => {
  try {
    await cleanup();
    await prisma.user.deleteMany({ where: { id: { startsWith: prefix } } });
  } finally {
    await application.close();
    await prisma.$disconnect();
  }
});

it('지원 내용 없이 이름만 보낸 Team 생성 요청은 거절한다', async () => {
  const response = await fetch(
    `${baseUrl}/api/v1/programs/${programId}/teams`,
    {
      method: 'POST',
      headers: {
        connection: 'close',
        'content-type': 'application/json',
        cookie,
        origin: allowedOrigin,
      },
      body: JSON.stringify({ name: 'Synthetic standalone team' }),
    },
  );
  const body: unknown = await response.json();
  const [teams, members, history] = await Promise.all([
    prisma.team.count({ where: { programId } }),
    prisma.teamMember.count({ where: { programId } }),
    prisma.teamHistory.count({ where: { programId } }),
  ]);

  expect({ status: response.status, teams, members, history }).toEqual({
    status: 400,
    teams: 0,
    members: 0,
    history: 0,
  });
  expect(body).toMatchObject({ status: 400 });
});

it('기존 공식 팀은 학생의 팀 조회 경로에서 계속 반환한다', async () => {
  const team = await prisma.team.create({
    data: {
        programId,
        name: 'Synthetic existing team',
        leaderId: userId,
        members: { create: { userId } },
        applicantId: userId,
        answers: { title: 'Synthetic existing team' },
        applicationTemplateVersion: 1
    }
});
  const response = await fetch(
    `${baseUrl}/api/v1/programs/${programId}/teams/me/membership`,
    { headers: { connection: 'close', cookie } },
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    membership: 'LEADER',
    team: {
      id: team.id,
      name: team.name,
      memberCount: 1,
      isLeader: true,
    },
  });
});

async function submitTeam() {
  const response = await fetch(`${baseUrl}/api/v1/programs/${programId}/teams`, {
    method: 'POST', headers: { connection: 'close', 'content-type': 'application/json', cookie, origin: allowedOrigin },
    body: JSON.stringify({ answers: { title: 'Synthetic project' }, teamName: 'Synthetic new team', applicationTemplateVersion: 1, isRepositoryPublicationPlanned: false }),
  });
  expect(response.status).toBe(201);
  return { response, team: await prisma.team.findFirstOrThrow({ where: { programId } }) };
}

it.each([true, false])('Team 경로는 생성·조회되고 이전 application 경로는 404다 (repository=%s)', async repositoryProvisioningEnabled => {
  await prisma.program.update({ where: { id: programId }, data: { repositoryProvisioningEnabled } });
  const { response, team } = await submitTeam();
  expect(await response.json()).toMatchObject({ id: team.id, teamId: team.id, status: 'SUBMITTED', repositoryConnectionMode: 'NEW', repositoryUrl: null });
  expect(team).toMatchObject({ repositoryConnectionMode: 'NEW', repositoryUrl: null, isRepositoryPublicationPlanned: false });
  const current = await fetch(`${baseUrl}/api/v1/programs/${programId}/teams/me`, { headers: { connection: 'close', cookie } });
  expect(current.status).toBe(200);
  expect(await current.json()).toMatchObject({ status: 'SUBMITTED', application: { id: team.id } });
  const previous = await fetch(`${baseUrl}/api/v1/programs/${programId}/applications/me`, { headers: { connection: 'close', cookie } });
  expect(previous.status).toBe(404);
  const oldCreate = await fetch(`${baseUrl}/api/v1/programs/${programId}/applications`, { method: 'POST', headers: { connection: 'close', 'content-type': 'application/json', cookie, origin: allowedOrigin }, body: '{}' });
  expect(oldCreate.status).toBe(404);
  expect(await prisma.team.count({ where: { programId } })).toBe(1);
  expect(await prisma.teamHistory.count({ where: { teamId: team.id, event: 'SUBMITTED' } })).toBe(1);
});

it('취소는 팀을 지우고 이력을 남기며 다시 지원하면 새 Team ID를 만든다', async () => {
  const first = await submitTeam();
  const cancel = await fetch(`${baseUrl}/api/v1/programs/${programId}/teams/me`, { method: 'DELETE', headers: { connection: 'close', cookie, origin: allowedOrigin } });
  expect(cancel.status).toBe(200);
  expect(await prisma.team.findUnique({ where: { id: first.team.id } })).toBeNull();
  expect(await prisma.teamHistory.findFirstOrThrow({ where: { teamId: first.team.id, event: 'DELETED' } })).toMatchObject({ actorId: userId, data: { reason: 'CANCELLED' } });
  const second = await submitTeam();
  expect(second.team.id).not.toBe(first.team.id);
  expect(await prisma.teamMember.count({ where: { programId, userId } })).toBe(1);
});

it('팀원은 위임할 수 없고 팀장은 위임한 뒤 탈퇴할 수 있다', async () => {
  const { team } = await submitTeam();
  const memberId = `${prefix}member`;
  const memberGithubId = githubId + 1n;
  await prisma.user.create({ data: canonicalUserCreateFromLabel('STUDENT', { id: memberId, githubId: memberGithubId, nickname: 'synthetic-team-member' }) });
  await prisma.teamMember.create({ data: { teamId: team.id, programId, userId: memberId } });
  const memberCookie = `${authSessionService.sessionCookieName(false)}=${await authSessionService.issueSessionToken(sessionSecret, memberGithubId, 0)}`;
  const denied = await fetch(`${baseUrl}/api/v1/programs/${programId}/teams/me/leader`, { method: 'PATCH', headers: { connection: 'close', 'content-type': 'application/json', cookie: memberCookie, origin: allowedOrigin }, body: JSON.stringify({ userId }) });
  expect(denied.status).toBe(403);
  const staffOnly = await fetch(`${baseUrl}/api/v1/programs/${programId}/teams/${team.id}/leader`, { method: 'PATCH', headers: { connection: 'close', 'content-type': 'application/json', cookie, origin: allowedOrigin }, body: JSON.stringify({ userId: memberId }) });
  expect(staffOnly.status).toBe(403);
  const blockedLeave = await fetch(`${baseUrl}/api/v1/programs/${programId}/teams/me/membership`, { method: 'DELETE', headers: { connection: 'close', cookie, origin: allowedOrigin } });
  expect(blockedLeave.status).toBe(409);
  const transfer = await fetch(`${baseUrl}/api/v1/programs/${programId}/teams/me/leader`, { method: 'PATCH', headers: { connection: 'close', 'content-type': 'application/json', cookie, origin: allowedOrigin }, body: JSON.stringify({ userId: memberId }) });
  expect(transfer.status).toBe(204);
  const leave = await fetch(`${baseUrl}/api/v1/programs/${programId}/teams/me/membership`, { method: 'DELETE', headers: { connection: 'close', cookie, origin: allowedOrigin } });
  expect(leave.status).toBe(204);
  expect(await prisma.team.findUniqueOrThrow({ where: { id: team.id } })).toMatchObject({ leaderId: memberId });
  expect(await prisma.teamMember.findMany({ where: { teamId: team.id }, select: { userId: true } })).toEqual([{ userId: memberId }]);
  expect(await prisma.teamHistory.count({ where: { teamId: team.id, event: 'LEADER_TRANSFERRED' } })).toBe(1);
  expect(await prisma.teamHistory.count({ where: { teamId: team.id, event: 'MEMBER_LEFT' } })).toBe(1);
});

it('승인 전 상태라도 제출이 남으면 취소와 마지막 탈퇴를 허용하지 않는다', async () => {
  const { team } = await submitTeam();
  const milestone = await prisma.milestone.create({ data: { programId, name: 'Synthetic milestone', startAt: new Date('2026-01-01'), dueAt: new Date('2099-01-01') } });
  const document = await prisma.milestoneDocument.create({ data: { milestoneId: milestone.id, name: 'Synthetic requirement', required: true, sortOrder: 1 } });
  await prisma.milestoneDocumentSubmission.create({ data: { teamId: team.id, milestoneDocumentId: document.id, submittedById: userId } });
  const membership = await fetch(`${baseUrl}/api/v1/programs/${programId}/teams/me/membership`, { headers: { connection: 'close', cookie } });
  expect(await membership.json()).toMatchObject({ team: { canLeave: false } });
  for (const path of ['teams/me', 'teams/me/membership']) {
    const response = await fetch(`${baseUrl}/api/v1/programs/${programId}/${path}`, { method: 'DELETE', headers: { connection: 'close', cookie, origin: allowedOrigin } });
    expect(response.status).toBe(409);
  }
  expect(await prisma.team.count({ where: { id: team.id } })).toBe(1);
  expect(await prisma.teamHistory.count({ where: { teamId: team.id, event: 'DELETED' } })).toBe(0);
});

it('사유 없이 반려할 수 있고 재제출은 같은 Team 행의 회차를 올린다', async () => {
  const { team } = await submitTeam();
  const staffGithubId = githubId + 2n;
  await prisma.user.create({ data: canonicalUserCreateFromLabel('STAFF', { id: `${prefix}staff`, githubId: staffGithubId, nickname: 'synthetic-team-reviewer' }) });
  const staffCookie = `${authSessionService.sessionCookieName(false)}=${await authSessionService.issueSessionToken(sessionSecret, staffGithubId, 0)}`;
  const detail = await fetch(`${baseUrl}/api/v1/teams/${team.id}`, { headers: { connection: 'close', cookie: staffCookie } });
  expect(detail.status).toBe(200);
  const legacy = await fetch(`${baseUrl}/api/v1/applications/${team.id}`, { headers: { connection: 'close', cookie: staffCookie } });
  expect(legacy.status).toBe(404);
  const rejected = await fetch(`${baseUrl}/api/v1/teams/${team.id}`, { method: 'PATCH', headers: { connection: 'close', 'content-type': 'application/json', cookie: staffCookie, origin: allowedOrigin }, body: JSON.stringify({ action: 'REJECT' }) });
  expect(rejected.status).toBe(200);
  expect(await prisma.team.findUniqueOrThrow({ where: { id: team.id } })).toMatchObject({ status: 'REJECTED', rejectionReason: null });
  const resubmitted = await fetch(`${baseUrl}/api/v1/programs/${programId}/teams/me`, { method: 'PATCH', headers: { connection: 'close', 'content-type': 'application/json', cookie, origin: allowedOrigin }, body: JSON.stringify({ answers: { title: 'Revised synthetic project' }, applicationTemplateVersion: 1 }) });
  expect(resubmitted.status).toBe(200);
  expect(await prisma.team.findUniqueOrThrow({ where: { id: team.id } })).toMatchObject({ status: 'SUBMITTED', revision: 2, rejectionReason: null });
  expect(await prisma.team.count({ where: { programId } })).toBe(1);
  expect(await prisma.teamHistory.count({ where: { teamId: team.id, event: 'REJECTED' } })).toBe(1);
  expect(await prisma.teamHistory.count({ where: { teamId: team.id, event: 'RESUBMITTED' } })).toBe(1);
});
