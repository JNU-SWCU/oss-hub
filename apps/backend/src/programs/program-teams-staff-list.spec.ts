import { ProgramCategory } from '@prisma/client';
import type { AuditLogService } from '../audit-log/audit-log.service';
import { loadRuntimeConfig } from '../runtime-config/runtime-config';
import { StaffProgramTeamResponseDto } from './dto/team-response.dto';
import {
  ProgramTeamsRepository,
  type StaffTeamRecord,
  type TeamProgramRecord,
} from './repository/program-teams.repository';
import { ProgramTeamsService } from './service/program-teams.service';
import { TeamsErrorCode } from './teams-error-code.enum';

/**
 * 교직원 전용 팀 목록(GET /programs/:programId/teams)의 응답 계약.
 * 학생도 쓰는 공개 로스터(`program-overview`의 `listPublicTeams`)와 달리 실명을 담지만,
 * 학번·학과·연락처·이메일·참여코드·저장소 URL 은 담지 않는다.
 */
const PROGRAM_ID = 'synthetic-program';
const JOIN_CODE_SECRET = 'synthetic-staff-list-secret';

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
}) {
  const findProgramById = jest
    .fn()
    .mockResolvedValue(
      overrides.program === undefined ? PROGRAM : overrides.program,
    );
  const listStaffTeams = jest.fn().mockResolvedValue(overrides.teams ?? []);
  const repository = {
    findProgramById,
    listStaffTeams,
  } as unknown as ProgramTeamsRepository;
  const service = new ProgramTeamsService(
    repository,
    loadRuntimeConfig({ TEAM_JOIN_CODE_SECRET: JOIN_CODE_SECRET }),
    { record: jest.fn() } as unknown as AuditLogService,
  );
  return { service, findProgramById, listStaffTeams };
}

describe('ProgramTeamsService.listForStaff', () => {
  it('팀 순서를 유지하고 각 팀에서 팀장을 멤버 배열 맨 앞으로 올린다', async () => {
    // Given: 팀장이 두 번째로 합류한(=createdAt 중간) 팀.
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

    // When
    const teams = await service.listForStaff(PROGRAM_ID);

    // Then: 팀은 repository 가 준 순서(createdAt asc) 그대로다.
    expect(teams.map((team) => team.teamId)).toEqual(['team-1', 'team-2']);
    // 팀장이 맨 앞, 나머지는 createdAt asc 순서를 유지한다.
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
    // Given
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

    // When
    const teams = await service.listForStaff(PROGRAM_ID);

    // Then
    expect(teams[0]?.members).toEqual([
      { userId: 'user-a', name: '가나다', nickname: 'login-a', isLeader: true },
      { userId: 'user-b', name: null, nickname: 'login-b', isLeader: false },
    ]);
  });

  it('팀이 없으면 빈 배열을 반환한다', async () => {
    const { service } = buildService({ teams: [] });

    await expect(service.listForStaff(PROGRAM_ID)).resolves.toEqual([]);
  });

  it('프로그램이 없으면 404 를 던지고 팀 조회를 하지 않는다', async () => {
    const { service, listStaffTeams } = buildService({ program: null });

    await expect(service.listForStaff(PROGRAM_ID)).rejects.toMatchObject({
      errorCode: { code: TeamsErrorCode.PROGRAM_NOT_FOUND, status: 404 },
    });
    expect(listStaffTeams).not.toHaveBeenCalled();
  });

  it('응답 DTO 는 계약 필드만 담고 금지 필드를 섞지 않는다', async () => {
    // Given
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

    // When: 컨트롤러가 내보내는 것과 동일한 직렬화 결과를 본다.
    const payload: unknown = JSON.parse(
      JSON.stringify(
        StaffProgramTeamResponseDto.fromAll(
          await service.listForStaff(PROGRAM_ID),
        ),
      ),
    );

    // Then: 모양이 정확히 계약과 같다.
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
    // 그리고 금지 필드는 문자열 어디에도 없다(중첩 깊이 무관).
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

describe('ProgramTeamsRepository.listStaffTeams', () => {
  /** jest.fn() 의 호출 인자는 any 라 명시적으로 좁혀 읽는다. */
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
    // Given: 한 명은 UserProfile.name, 다른 한 명은 legacy User.name, 나머지는 둘 다 없다.
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

    // When
    const teams = await repository.listStaffTeams(PROGRAM_ID);

    // Then: 실명의 정본은 UserProfile.name 하나다. 행이 없으면 null이다.
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
    // Given
    const { repository, findMany } = buildRepository([]);

    // When
    await repository.listStaffTeams(PROGRAM_ID);

    // Then
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
    // TeamMember.name 은 아무 writer 도 채우지 않는 죽은 컬럼이라 멤버 select 에 없다.
    const members: { select: Record<string, unknown> } = args.select
      .members as never;
    expect(members.select).not.toHaveProperty('name');
  });
});
