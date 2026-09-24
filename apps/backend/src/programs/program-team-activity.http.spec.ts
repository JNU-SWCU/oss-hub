import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { AccountStatus } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuthConfig } from '../auth/auth.config';
import { AuthService } from '../auth/auth.service';
import { sessionCookieName } from '../auth/cookies';
import { OriginGuard } from '../auth/origin.guard';
import { issueSessionToken } from '../auth/session-token';
import { SessionGuard } from '../auth/session.guard';
import { ProblemDetailFilter } from '../common/problem-detail.filter';
import { PrismaService } from '../prisma/prisma.service';
import { loadRuntimeConfig } from '../runtime-config/runtime-config';
import { RUNTIME_CONFIG } from '../runtime-config/runtime-config.module';
import { ProgramTeamsController } from './controller/program-teams.controller';
import { ProgramTeamsStaffGuard } from './program-teams-staff.guard';
import { ProgramTeamDeletionRepository } from './repository/program-team-deletion.repository';
import { ProgramTeamsRepository } from './repository/program-teams.repository';
import { ProgramTeamsService } from './service/program-teams.service';

/**
 * `GET /programs/:programId/teams/:teamId/activity`(#1133)를 실제 HTTP 파이프라인으로
 * 확인한다. controller·service·repository는 진짜이고 그 아래 Prisma만 합성 값이다 —
 * 같은 팀·같은 시각이면 팀장·팀원·교직원이 `canEditRepositoryUrl` 말고는 같은 본문을
 * 받는지, 팀 밖 사람과 없는 팀이 같은 404인지 본다.
 */
const sessionSecret = new Uint8Array(32).fill(7);
const PROGRAM_ID = 'synthetic-program';
const TEAM_ID = 'synthetic-team';
const ACTORS = {
  leader: { githubId: 7001n, id: 'user-leader', staff: false },
  member: { githubId: 7002n, id: 'user-member', staff: false },
  staff: { githubId: 7003n, id: 'user-staff', staff: true },
  outsider: { githubId: 7004n, id: 'user-outsider', staff: false },
} as const;

const findUnique = jest.fn(
  ({ where }: { readonly where: { readonly githubId: bigint } }) => {
    const actor = Object.values(ACTORS).find(
      (candidate) => candidate.githubId === where.githubId,
    );
    return Promise.resolve(
      actor && {
        id: actor.id,
        hasStaffAccess: actor.staff,
        hasAdminAccess: false,
        accountStatus: AccountStatus.ACTIVE,
      },
    );
  },
);
const findFirst = jest.fn();
const findMany = jest.fn();

let application: INestApplication | undefined;
let baseUrl = '';

async function getActivity(
  actor: keyof typeof ACTORS,
  teamId = TEAM_ID,
): Promise<Response> {
  const token = await issueSessionToken(
    sessionSecret,
    ACTORS[actor].githubId,
    0,
  );
  return fetch(
    `${baseUrl}/api/v1/programs/${PROGRAM_ID}/teams/${teamId}/activity`,
    {
      headers: {
        connection: 'close',
        cookie: `${sessionCookieName(false)}=${token}`,
      },
    },
  );
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [ProgramTeamsController],
    providers: [
      ProgramTeamsService,
      ProgramTeamsRepository,
      { provide: ProgramTeamDeletionRepository, useValue: {} },
      { provide: AuditLogService, useValue: {} },
      {
        provide: RUNTIME_CONFIG,
        useValue: loadRuntimeConfig({
          TEAM_JOIN_CODE_SECRET: 'synthetic-join-code-secret',
        }),
      },
      SessionGuard,
      OriginGuard,
      ProgramTeamsStaffGuard,
      {
        provide: AuthService,
        useValue: {
          getMe: jest
            .fn()
            .mockResolvedValue({ id: 'synthetic', sessionVersion: 0 }),
        },
      },
      {
        provide: AuthConfig,
        useValue: {
          sessionSecret,
          allowedOrigin: 'http://frontend.test',
          useSecureCookies: false,
        },
      },
      {
        provide: PrismaService,
        useValue: {
          user: { findUnique },
          team: { findFirst },
          contribution: { findMany },
        },
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
});

beforeEach(() => {
  findFirst.mockReset();
  findMany.mockReset();
  findFirst.mockImplementation(
    ({ where }: { readonly where: { readonly id: string } }) =>
      Promise.resolve(
        where.id === TEAM_ID
          ? {
              leaderId: ACTORS.leader.id,
              program: {
                startAt: new Date('2026-07-31T15:00:00Z'),
                endAt: new Date('2999-12-31T14:59:59Z'),
              },
              members: [
                {
                  userId: ACTORS.leader.id,
                  user: { githubId: ACTORS.leader.githubId, nickname: 'lead' },
                },
                {
                  userId: ACTORS.member.id,
                  user: { githubId: ACTORS.member.githubId, nickname: 'mate' },
                },
              ],
              applications: [
                {
                  id: 'synthetic-application',
                  status: 'APPROVED',
                  repository: {
                    id: 'synthetic-repository',
                    nameWithOwner: 'synthetic-org/synthetic-repo',
                    lastSuccessAt: new Date('2026-08-10T00:00:00Z'),
                    failureCount: 0,
                  },
                },
              ],
            }
          : null,
      ),
  );
  findMany.mockResolvedValue([
    {
      githubId: ACTORS.leader.githubId,
      date: new Date('2026-08-01T00:00:00Z'),
      commitCount: 2,
      pullRequestCount: 1,
      issueCount: 0,
    },
    {
      githubId: ACTORS.leader.githubId,
      date: new Date('2026-08-03T00:00:00Z'),
      commitCount: 1,
      pullRequestCount: 0,
      issueCount: 3,
    },
  ]);
});

afterAll(async () => {
  if (application !== undefined) await application.close();
});

it('팀장·팀원·교직원이 canEditRepositoryUrl 말고는 같은 본문을 받는다', async () => {
  // Given — 승인된 신청이고 프로그램이 아직 끝나지 않았다.
  // When
  const responses = await Promise.all([
    getActivity('leader'),
    getActivity('member'),
    getActivity('staff'),
  ]);
  // Then
  expect(responses.map((response) => response.status)).toEqual([200, 200, 200]);
  const bodies = (await Promise.all(
    responses.map((response) => response.json()),
  )) as Record<string, unknown>[];
  const [leader, member, staff] = bodies.map(
    ({ canEditRepositoryUrl, ...shared }) => ({ canEditRepositoryUrl, shared }),
  );
  expect(
    [leader, member, staff].map((body) => body?.canEditRepositoryUrl),
  ).toEqual([true, false, true]);
  expect(member?.shared).toEqual(leader?.shared);
  expect(staff?.shared).toEqual(leader?.shared);
  expect(bodies[0]).toEqual({
    applicationId: 'synthetic-application',
    repository: {
      id: 'synthetic-repository',
      url: 'https://github.com/synthetic-org/synthetic-repo',
    },
    status: 'COLLECTED',
    lastSuccessAt: '2026-08-10T00:00:00.000Z',
    window: { from: '2026-08-01', to: '2999-12-31', timeZone: 'Asia/Seoul' },
    canEditRepositoryUrl: true,
    members: [
      {
        userId: ACTORS.leader.id,
        githubLogin: 'lead',
        totals: { commitCount: 3, pullRequestCount: 1, issueCount: 3 },
        points: [
          {
            date: '2026-08-01',
            commitCount: 2,
            pullRequestCount: 1,
            issueCount: 0,
          },
          {
            date: '2026-08-03',
            commitCount: 1,
            pullRequestCount: 0,
            issueCount: 3,
          },
        ],
      },
      {
        userId: ACTORS.member.id,
        githubLogin: 'mate',
        totals: { commitCount: 0, pullRequestCount: 0, issueCount: 0 },
        points: [],
      },
    ],
  });
});

it.each([
  ['팀 밖의 학생', 'outsider', TEAM_ID],
  ['없는 팀을 묻는 교직원', 'staff', 'missing-team'],
] as const)(
  '%s은 같은 404(TEAM_010)를 받고 활동 행은 읽히지 않는다',
  async (_label, actor, teamId) => {
    // When
    const response = await getActivity(actor, teamId);
    // Then
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      status: 404,
      code: 'TEAM_010',
    });
    expect(findMany).not.toHaveBeenCalled();
  },
);
