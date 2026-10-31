import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ProgramCategory } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { AuditLogRepository } from '../platform/audit-log.repository';
import { AuditLogService } from '../platform/audit-log.service';
import { AuthConfig } from '../auth/auth.config';
import { OriginGuard } from '../auth/origin.guard';
import { SessionGuard } from '../auth/session.guard';
import {
  AuthService,
  sessionCookieName,
  issueSessionToken,
} from '../auth/auth.service';
import { ProblemDetailFilter } from '../platform/problem-detail.filter';
import { PrismaService } from '../platform/prisma.service';
import { UsersAuthorityRepository } from '../users/independent-authority.repository';
import { canonicalUserCreateFromLabel } from '../users/canonical-user-fixture';
import { UsersAuthorityService } from '../users/users-authority.service';
import { ProgramTeamDeletionRepository } from './program-team-deletion.repository';
import { ProgramTeamsRepository } from './program-teams.repository';
import { ProgramTeamsService } from './program-teams.service';
import { ProgramTeamsController } from './program-teams.controller';
import { AuditLogMetadataService } from '../platform/audit-log-metadata.service';

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
  await prisma.teamMember.deleteMany({ where: { programId } });
  await prisma.team.deleteMany({ where: { programId } });
  await prisma.program.deleteMany({ where: { id: programId } });
}

beforeAll(async () => {
  await prisma.$connect();
  const service = new ProgramTeamsService(
    new ProgramTeamsRepository(prisma),
    new AuditLogService(
      new AuditLogRepository(prisma),
      new AuditLogMetadataService(),
    ),
    new ProgramTeamDeletionRepository(prisma),
    new UsersAuthorityService(new UsersAuthorityRepository(prisma)),
    new AuditLogMetadataService(),
  );
  const moduleRef = await Test.createTestingModule({
    controllers: [ProgramTeamsController],
    providers: [
      { provide: ProgramTeamsService, useValue: service },
      SessionGuard,
      OriginGuard,
      {
        provide: AuthService,
        useValue: {
          getMe: () =>
            prisma.user.findUniqueOrThrow({
              where: { githubId },
              select: { id: true, sessionVersion: true },
            }),
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
  cookie = `${sessionCookieName(false)}=${await issueSessionToken(sessionSecret, githubId, 0)}`;
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
    }),
  });
  await prisma.program.create({
    data: {
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
      teamMaxSize: 3,
    },
  });
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await application.close();
    await prisma.$disconnect();
  }
});

it('유효한 학생도 신청 없이 공식 팀을 생성하는 POST 경로를 사용할 수 없다', async () => {
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
  const [teams, members, applications] = await Promise.all([
    prisma.team.count({ where: { programId } }),
    prisma.teamMember.count({ where: { programId } }),
    prisma.application.count({ where: { programId } }),
  ]);

  expect({ status: response.status, teams, members, applications }).toEqual({
    status: 404,
    teams: 0,
    members: 0,
    applications: 0,
  });
  expect(body).toMatchObject({ status: 404, code: 'SYS_002' });
});

it('기존 공식 팀은 학생의 팀 조회 경로에서 계속 반환한다', async () => {
  const team = await prisma.team.create({
    data: {
      programId,
      name: 'Synthetic existing team',
      leaderId: userId,
      joinCodeDigest: `${prefix}existing-team`,
      members: { create: { userId } },
    },
  });
  const response = await fetch(
    `${baseUrl}/api/v1/programs/${programId}/teams/me`,
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
