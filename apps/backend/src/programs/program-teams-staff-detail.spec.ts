import type { AuditLogService } from '../audit-log/audit-log.service';
import { loadRuntimeConfig } from '../runtime-config/runtime-config';
import { StaffTeamDetailResponseDto } from './dto/team-detail-response.dto';
import {
  ProgramTeamsRepository,
  type StaffTeamDetailRecord,
} from './repository/program-teams.repository';
import { ProgramTeamsService } from './service/program-teams.service';
import { TeamsErrorCode } from './teams-error-code.enum';

/**
 * 교직원 전용 팀 상세(GET /programs/:programId/teams/:teamId, #874)의 응답 계약.
 * 팀원(실명 포함)에 신청 상태·저장소 발급 상태를 더한다. 없는 팀·다른 프로그램의
 * 팀은 구분 없이 같은 404다 — `findStaffTeamDetail`이 이미 `programId`로 걸러
 * 두 경우를 하나의 null 로 합친다(repository 테스트로 그 select 를 확인한다).
 */
const PROGRAM_ID = 'synthetic-program';
const TEAM_ID = 'synthetic-team';
const JOIN_CODE_SECRET = 'synthetic-staff-detail-secret';

function buildService(overrides: {
  readonly detail?: StaffTeamDetailRecord | null;
}) {
  const findStaffTeamDetail = jest
    .fn()
    .mockResolvedValue(
      overrides.detail === undefined ? null : overrides.detail,
    );
  const repository = {
    findStaffTeamDetail,
  } as unknown as ProgramTeamsRepository;
  const service = new ProgramTeamsService(
    repository,
    loadRuntimeConfig({ TEAM_JOIN_CODE_SECRET: JOIN_CODE_SECRET }),
    { record: jest.fn() } as unknown as AuditLogService,
  );
  return { service, findStaffTeamDetail };
}

describe('ProgramTeamsService.getForStaff', () => {
  it('팀장을 멤버 배열 맨 앞으로 올리고 신청이 없으면 application: null', async () => {
    const { service } = buildService({
      detail: {
        id: TEAM_ID,
        name: '오픈소스팀',
        leaderId: 'user-b',
        members: [
          { userId: 'user-a', nickname: 'login-a', name: '가나다' },
          { userId: 'user-b', nickname: 'login-b', name: '라마바' },
        ],
        application: null,
      },
    });

    const detail = await service.getForStaff(PROGRAM_ID, TEAM_ID);

    expect(detail.teamId).toBe(TEAM_ID);
    expect(detail.members.map((member) => member.userId)).toEqual([
      'user-b',
      'user-a',
    ]);
    expect(detail.members.map((member) => member.isLeader)).toEqual([
      true,
      false,
    ]);
    expect(detail.memberCount).toBe(2);
    expect(detail.application).toBeNull();
  });

  it('신청이 있으면 저장소 발급 상태를 그대로 싣는다', async () => {
    const { service } = buildService({
      detail: {
        id: TEAM_ID,
        name: '오픈소스팀',
        leaderId: 'user-a',
        members: [{ userId: 'user-a', nickname: 'login-a', name: '가나다' }],
        application: {
          id: 'application-1',
          status: 'APPROVED',
          repositoryConnectionMode: 'NEW',
          repository: {
            id: 'repository-1',
            url: 'https://github.com/org/repo',
            visibility: 'PUBLIC',
            publishEligible: true,
            blockedReasons: [],
          },
          repositoryProvisioning: {
            enabled: true,
            jobStatus: 'SUCCEEDED',
            updatedAt: new Date('2026-08-01T00:00:00.000Z'),
            safeErrorClass: null,
          },
        },
      },
    });

    const detail = await service.getForStaff(PROGRAM_ID, TEAM_ID);

    expect(detail.application).toEqual({
      id: 'application-1',
      status: 'APPROVED',
      repositoryConnectionMode: 'NEW',
      repository: {
        id: 'repository-1',
        url: 'https://github.com/org/repo',
        visibility: 'PUBLIC',
        publishEligible: true,
        blockedReasons: [],
      },
      repositoryProvisioning: {
        enabled: true,
        jobStatus: 'SUCCEEDED',
        updatedAt: new Date('2026-08-01T00:00:00.000Z'),
        safeErrorClass: null,
      },
    });
  });

  it('팀을 찾지 못하면 404 TEAM_NOT_FOUND — 없는 팀과 다른 프로그램의 팀을 구분하지 않는다', async () => {
    const { service, findStaffTeamDetail } = buildService({ detail: null });

    await expect(
      service.getForStaff(PROGRAM_ID, TEAM_ID),
    ).rejects.toMatchObject({
      errorCode: { code: TeamsErrorCode.TEAM_NOT_FOUND, status: 404 },
    });
    expect(findStaffTeamDetail).toHaveBeenCalledWith(PROGRAM_ID, TEAM_ID);
  });

  it('응답 DTO 는 계약 필드만 담고 금지 필드를 섞지 않는다', async () => {
    const { service } = buildService({
      detail: {
        id: TEAM_ID,
        name: '오픈소스팀',
        leaderId: 'user-a',
        members: [{ userId: 'user-a', nickname: 'login-a', name: '가나다' }],
        application: {
          id: 'application-1',
          status: 'SUBMITTED',
          repositoryConnectionMode: 'NEW',
          repository: null,
          repositoryProvisioning: {
            enabled: true,
            jobStatus: 'NOT_REQUESTED',
            updatedAt: new Date('2026-08-01T00:00:00.000Z'),
            safeErrorClass: null,
          },
        },
      },
    });

    const payload: unknown = JSON.parse(
      JSON.stringify(
        StaffTeamDetailResponseDto.from(
          await service.getForStaff(PROGRAM_ID, TEAM_ID),
        ),
      ),
    );

    expect(payload).toEqual({
      teamId: TEAM_ID,
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
      application: {
        id: 'application-1',
        status: 'SUBMITTED',
        repositoryConnectionMode: 'NEW',
        repository: null,
        repositoryProvisioning: {
          enabled: true,
          jobStatus: 'NOT_REQUESTED',
          updatedAt: '2026-08-01T00:00:00.000Z',
          safeErrorClass: null,
        },
      },
    });
    // repository/url 은 이 응답에서 의도적으로 담는 값이라 금지어에서 뺀다
    // (team-detail-response.dto.ts 주석 참고).
    const serialized = JSON.stringify(payload);
    for (const forbidden of [
      'studentId',
      'department',
      'phone',
      'email',
      'joinCode',
      'joinCodeDigest',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});

describe('ProgramTeamsRepository.findStaffTeamDetail', () => {
  afterEach(() => jest.useRealTimers());

  function readTeamSelect(spy: jest.Mock): {
    where: Record<string, unknown>;
    select: Record<string, unknown>;
  } {
    const calls = spy.mock.calls as unknown as {
      where: Record<string, unknown>;
      select: Record<string, unknown>;
    }[][];
    const args = calls[0]?.[0];
    if (args === undefined) {
      throw new Error('team.findFirst 가 호출되지 않았다');
    }
    return args;
  }

  function buildRepository(overrides: {
    readonly team?: unknown;
    readonly application?: unknown;
    readonly outbox?: unknown;
    readonly job?: unknown;
  }) {
    const teamFindFirst = jest
      .fn()
      .mockResolvedValue(overrides.team === undefined ? null : overrides.team);
    const applicationFindFirst = jest
      .fn()
      .mockResolvedValue(
        overrides.application === undefined ? null : overrides.application,
      );
    const outboxFindUnique = jest
      .fn()
      .mockResolvedValue(overrides.outbox ?? null);
    const jobFindUnique = jest.fn().mockResolvedValue(overrides.job ?? null);
    const prisma = {
      team: { findFirst: teamFindFirst },
      application: { findFirst: applicationFindFirst },
      outboxEvent: { findUnique: outboxFindUnique },
      repositoryProvisionJob: { findUnique: jobFindUnique },
    };
    return {
      repository: new ProgramTeamsRepository(prisma as never),
      teamFindFirst,
      applicationFindFirst,
    };
  }

  it('팀을 programId+teamId 로 조회해 다른 프로그램의 teamId 는 걸러낸다', async () => {
    const { repository, teamFindFirst } = buildRepository({ team: null });

    const result = await repository.findStaffTeamDetail(PROGRAM_ID, TEAM_ID);

    expect(result).toBeNull();
    expect(teamFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: TEAM_ID, programId: PROGRAM_ID },
      }),
    );
  });

  it('팀은 있지만 신청이 없으면 application: null 이고 Application 조회로 저장소를 읽는다', async () => {
    const { repository, applicationFindFirst } = buildRepository({
      team: {
        id: TEAM_ID,
        name: '오픈소스팀',
        leaderId: 'user-a',
        members: [
          { userId: 'user-a', user: { nickname: 'login-a', name: '가나다' } },
        ],
      },
      application: null,
    });

    const result = await repository.findStaffTeamDetail(PROGRAM_ID, TEAM_ID);

    expect(result?.application).toBeNull();
    expect(applicationFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { programId: PROGRAM_ID, teamId: TEAM_ID },
      }),
    );
  });

  it('서류 전용 마일스톤 승인만으로도 같은 공개 게이트를 통과한 저장소를 싣는다', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-13T00:00:00.000Z'));
    const { repository } = buildRepository({
      team: {
        id: TEAM_ID,
        name: '서류 전용 팀',
        leaderId: 'user-a',
        members: [
          { userId: 'user-a', user: { nickname: 'login-a', name: '가나다' } },
        ],
      },
      application: {
        id: 'application-1',
        status: 'APPROVED',
        updatedAt: new Date('2026-08-12T00:00:00.000Z'),
        repositoryConnectionMode: 'NEW',
        isRepositoryPublicationPlanned: true,
        repository: {
          id: 'repository-1',
          nameWithOwner: 'org/repo',
          visibility: 'PRIVATE',
        },
        program: {
          repositoryProvisioningEnabled: true,
          endAt: new Date('2026-08-12T00:00:00.000Z'),
          milestones: [
            { id: 'milestone-1', documents: [{ id: 'document-1' }] },
          ],
        },
        milestoneDocumentSubmissions: [
          {
            status: 'APPROVED',
            milestoneDocument: {
              id: 'document-1',
              milestoneId: 'milestone-1',
              kind: 'DOCUMENT',
            },
          },
        ],
      },
      job: {
        status: 'SUCCEEDED',
        updatedAt: new Date('2026-08-12T01:00:00.000Z'),
        lastErrorCode: null,
        repositoryId: 'repository-1',
      },
    });

    const result = await repository.findStaffTeamDetail(PROGRAM_ID, TEAM_ID);

    expect(result?.application?.repository).toMatchObject({
      id: 'repository-1',
      publishEligible: true,
      blockedReasons: [],
    });
  });

  it('금지 필드를 select 하지 않는다 (학번·학과·연락처·이메일·참여코드) 그리고 Team.repositories 를 select 하지 않는다', async () => {
    const { repository, teamFindFirst } = buildRepository({ team: null });

    await repository.findStaffTeamDetail(PROGRAM_ID, TEAM_ID);

    const args = readTeamSelect(teamFindFirst);
    for (const forbidden of [
      'joinCodeDigest',
      'repositories',
      'applications',
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
