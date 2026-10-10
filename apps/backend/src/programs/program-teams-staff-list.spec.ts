import { ProgramCategory } from '@prisma/client';
import type { AuditLogService } from '../audit-log/service/audit-log.service';
import { AccountStatus } from '@prisma/client';
import { loadRuntimeConfig } from '../runtime-config/runtime-config';
import { UsersAuthorityService } from '../users/service/authority.service';
import { StaffProgramTeamResponseDto } from './dto/team-response.dto';
import {
  ProgramTeamsRepository,
  type StaffTeamRecord,
  type TeamProgramRecord,
} from './repository/program-teams.repository';
import { ProgramTeamsService } from './service/program-teams.service';
import { stubTeamDeletionRepository } from './service/program-teams.service.test-support';
import { TeamsErrorCode } from './teams-error-code.enum';

const PROGRAM_ID = 'synthetic-program';
const JOIN_CODE_SECRET = 'synthetic-staff-list-secret';
const STAFF_GITHUB_ID = 5201n;

type AuthorityActor = {
  readonly id: string;
  readonly hasStaffAccess: boolean;
  readonly hasAdminAccess: boolean;
  readonly accountStatus: AccountStatus;
};

const STAFF_USER: AuthorityActor = {
  id: 'synthetic-staff',
  hasStaffAccess: true,
  hasAdminAccess: false,
  accountStatus: AccountStatus.ACTIVE,
};

const ADMIN_USER: AuthorityActor = {
  id: 'synthetic-admin',
  hasStaffAccess: false,
  hasAdminAccess: true,
  accountStatus: AccountStatus.ACTIVE,
};

const STUDENT_USER: AuthorityActor = {
  id: 'synthetic-student',
  hasStaffAccess: false,
  hasAdminAccess: false,
  accountStatus: AccountStatus.ACTIVE,
};

const INACTIVE_STAFF_USER: AuthorityActor = {
  id: 'synthetic-inactive-staff',
  hasStaffAccess: true,
  hasAdminAccess: true,
  accountStatus: AccountStatus.DEACTIVATED,
};

const PROGRAM: TeamProgramRecord = {
  id: PROGRAM_ID,
  name: '합성 프로그램',
  category: ProgramCategory.OSS_CONTEST,
  applicationStartAt: new Date('2026-07-01T00:00:00.000Z'),
  applicationEndAt: new Date('2026-07-31T23:59:59.000Z'),
  teamMinSize: 2,
  teamMaxSize: 4,
};

function buildService(overrides: {
  readonly program?: TeamProgramRecord | null;
  readonly teams?: readonly StaffTeamRecord[];
  readonly actor?: AuthorityActor | null;
}) {
  const findProgramById = jest
    .fn()
    .mockResolvedValue(
      overrides.program === undefined ? PROGRAM : overrides.program,
    );
  const listStaffTeams = jest.fn().mockResolvedValue(overrides.teams ?? []);
  const findActorByGithubId = jest
    .fn()
    .mockResolvedValue(
      overrides.actor === undefined ? STAFF_USER : overrides.actor,
    );
  const repository = {
    findProgramById,
    listStaffTeams,
  } as unknown as ProgramTeamsRepository;
  const service = new ProgramTeamsService(
    repository,
    loadRuntimeConfig({ TEAM_JOIN_CODE_SECRET: JOIN_CODE_SECRET }),
    { record: jest.fn() } as unknown as AuditLogService,
    stubTeamDeletionRepository(),
    new UsersAuthorityService({ findActorByGithubId }),
  );
  return { service, findProgramById, listStaffTeams, findActorByGithubId };
}

describe('ProgramTeamsService.listForStaff', () => {
  it('팀 순서를 유지하고 각 팀에서 팀장을 멤버 배열 맨 앞으로 올린다', async () => {
    const { service } = buildService({
      teams: [
        {
          id: 'team-1',
          name: '먼저 만든 팀',
          leaderId: 'user-b',
          members: [
            { userId: 'user-a', nickname: 'login-a', name: '가나다' },
            { userId: 'user-b', nickname: 'login-b', name: '라마바' },
            { userId: 'user-c', nickname: 'login-c', name: '사아자' },
          ],
        },
        {
          id: 'team-2',
          name: '나중에 만든 팀',
          leaderId: 'user-d',
          members: [{ userId: 'user-d', nickname: 'login-d', name: '차카타' }],
        },
      ],
    });

    const teams = await service.listForStaff(STAFF_GITHUB_ID, PROGRAM_ID);

    expect(teams.map((team) => team.teamId)).toEqual(['team-1', 'team-2']);

    expect(teams[0]?.members.map((member) => member.userId)).toEqual([
      'user-b',
      'user-a',
      'user-c',
    ]);
    expect(teams[0]?.members.map((member) => member.isLeader)).toEqual([
      true,
      false,
      false,
    ]);
    expect(teams[0]?.memberCount).toBe(3);
    expect(teams[1]?.memberCount).toBe(1);
  });

  it('멤버의 실명을 그대로 담고 프로필이 없는 계정은 name: null 로 떨어진다', async () => {
    const { service } = buildService({
      teams: [
        {
          id: 'team-1',
          name: '오픈소스팀',
          leaderId: 'user-a',
          members: [
            { userId: 'user-a', nickname: 'login-a', name: '가나다' },
            { userId: 'user-b', nickname: 'login-b', name: null },
          ],
        },
      ],
    });

    const teams = await service.listForStaff(STAFF_GITHUB_ID, PROGRAM_ID);

    expect(teams[0]?.members).toEqual([
      { userId: 'user-a', name: '가나다', nickname: 'login-a', isLeader: true },
      { userId: 'user-b', name: null, nickname: 'login-b', isLeader: false },
    ]);
  });

  it('팀이 없으면 빈 배열을 반환한다', async () => {
    const { service } = buildService({ teams: [] });

    await expect(
      service.listForStaff(STAFF_GITHUB_ID, PROGRAM_ID),
    ).resolves.toEqual([]);
  });

  it('프로그램이 없으면 404 를 던지고 팀 조회를 하지 않는다', async () => {
    const { service, listStaffTeams } = buildService({ program: null });

    await expect(
      service.listForStaff(STAFF_GITHUB_ID, PROGRAM_ID),
    ).rejects.toMatchObject({
      errorCode: { code: TeamsErrorCode.PROGRAM_NOT_FOUND, status: 404 },
    });
    expect(listStaffTeams).not.toHaveBeenCalled();
  });

  it('응답 DTO 는 계약 필드만 담고 금지 필드를 섞지 않는다', async () => {
    const { service } = buildService({
      teams: [
        {
          id: 'team-1',
          name: '오픈소스팀',
          leaderId: 'user-a',
          members: [{ userId: 'user-a', nickname: 'login-a', name: '가나다' }],
        },
      ],
    });

    const payload: unknown = JSON.parse(
      JSON.stringify(
        StaffProgramTeamResponseDto.fromAll(
          await service.listForStaff(STAFF_GITHUB_ID, PROGRAM_ID),
        ),
      ),
    );

    expect(payload).toEqual([
      {
        teamId: 'team-1',
        name: '오픈소스팀',
        memberCount: 1,
        members: [
          {
            userId: 'user-a',
            name: '가나다',
            nickname: 'login-a',
            isLeader: true,
          },
        ],
      },
    ]);

    const serialized = JSON.stringify(payload);
    for (const forbidden of [
      'studentId',
      'department',
      'phone',
      'email',
      'joinCode',
      'joinCodeDigest',
      'repository',
      'repositories',
      'url',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});

describe('ProgramTeamsService.listForStaff 권한', () => {
  const TEAM: StaffTeamRecord = {
    id: 'team-1',
    name: '오픈소스팀',
    leaderId: 'user-a',
    members: [{ userId: 'user-a', nickname: 'login-a', name: '가나다' }],
  };

  it.each([
    ['STAFF', STAFF_USER],
    ['ADMIN', ADMIN_USER],
  ] as const)(
    'ACTIVE %s 는 세션 식별자로 권한을 확인한 뒤 팀을 읽는다',
    async (_label, actor) => {
      const { service, findActorByGithubId, findProgramById, listStaffTeams } =
        buildService({ actor, teams: [TEAM] });

      const teams = await service.listForStaff(STAFF_GITHUB_ID, PROGRAM_ID);

      expect(teams.map((team) => team.teamId)).toEqual(['team-1']);
      expect(findActorByGithubId).toHaveBeenCalledWith(STAFF_GITHUB_ID);
      expect(findProgramById).toHaveBeenCalledWith(PROGRAM_ID);
      expect(listStaffTeams).toHaveBeenCalledWith(PROGRAM_ID);
    },
  );

  it.each([
    ['STUDENT', STUDENT_USER],
    ['비활성 STAFF', INACTIVE_STAFF_USER],
    ['없는 계정', null],
  ] as const)(
    '%s 은 프로그램·팀 조회 전에 403 TEAM_003 으로 막힌다',
    async (_label, actor) => {
      const { service, findActorByGithubId, findProgramById, listStaffTeams } =
        buildService({ actor, teams: [TEAM] });

      await expect(
        service.listForStaff(STAFF_GITHUB_ID, PROGRAM_ID),
      ).rejects.toMatchObject({
        errorCode: { code: TeamsErrorCode.STAFF_ONLY, status: 403 },
      });
      expect(findActorByGithubId).toHaveBeenCalledWith(STAFF_GITHUB_ID);
      expect(findProgramById).not.toHaveBeenCalled();
      expect(listStaffTeams).not.toHaveBeenCalled();
    },
  );
});

describe('ProgramTeamsRepository.listStaffTeams', () => {
  function readCallArgs(spy: jest.Mock): { select: Record<string, unknown> } {
    const calls = spy.mock.calls as unknown as {
      select: Record<string, unknown>;
    }[][];
    const args = calls[0]?.[0];
    if (args === undefined) {
      throw new Error('team.findMany 가 호출되지 않았다');
    }
    return args;
  }

  function buildRepository(rows: unknown[]) {
    const findMany = jest.fn().mockResolvedValue(rows);
    const prisma = { team: { findMany } };
    return {
      repository: new ProgramTeamsRepository(prisma as never),
      findMany,
    };
  }

  it('팀·멤버를 createdAt 오름차순으로 요청하고 실명을 정식 경로로 합친다', async () => {
    const { repository, findMany } = buildRepository([
      {
        id: 'team-1',
        name: '오픈소스팀',
        leaderId: 'user-a',
        members: [
          {
            userId: 'user-a',
            user: { nickname: 'login-a', profile: { name: '프로필 이름' } },
          },
          {
            userId: 'user-b',
            user: { nickname: 'login-b', profile: null },
          },
          {
            userId: 'user-c',
            user: { nickname: 'login-c', name: null, profile: null },
          },
        ],
      },
    ]);

    const teams = await repository.listStaffTeams(PROGRAM_ID);

    expect(teams).toEqual([
      {
        id: 'team-1',
        name: '오픈소스팀',
        leaderId: 'user-a',
        members: [
          { userId: 'user-a', nickname: 'login-a', name: '프로필 이름' },
          { userId: 'user-b', nickname: 'login-b', name: null },
          { userId: 'user-c', nickname: 'login-c', name: null },
        ],
      },
    ]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { programId: PROGRAM_ID },
        orderBy: { createdAt: 'asc' },
      }),
    );
    const args = readCallArgs(findMany);
    expect(args.select.members).toMatchObject({
      orderBy: { createdAt: 'asc' },
    });
  });

  it('금지 필드를 select 하지 않는다 (학번·학과·연락처·이메일·참여코드·저장소)', async () => {
    const { repository, findMany } = buildRepository([]);

    await repository.listStaffTeams(PROGRAM_ID);

    const args = readCallArgs(findMany);
    for (const forbidden of [
      'joinCodeDigest',
      'repositories',
      'applications',
      'invitations',
    ]) {
      expect(args.select).not.toHaveProperty(forbidden);
    }
    const serializedSelect = JSON.stringify(args.select);
    for (const forbidden of [
      'studentId',
      'department',
      'phone',
      'email',
      'joinCodeDigest',
      'repositories',
    ]) {
      expect(serializedSelect).not.toContain(forbidden);
    }

    const members: { select: Record<string, unknown> } = args.select
      .members as never;
    expect(members.select).not.toHaveProperty('name');
  });
});
