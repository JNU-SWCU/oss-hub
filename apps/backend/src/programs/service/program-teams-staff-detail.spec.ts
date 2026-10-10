import type { AuditLogService } from '../../audit-log/service/audit-log.service';
import { AccountStatus } from '@prisma/client';
import { loadRuntimeConfig } from '../../runtime-config/runtime-config';
import { UsersAuthorityService } from '../../users/service/authority.service';
import { StaffTeamDetailResponseDto } from '../dto/team-detail-response.dto';
import {
  ProgramTeamsRepository,
  type StaffTeamDetailRecord,
} from '../repository/program-teams.repository';
import { ProgramTeamsService } from './program-teams.service';
import { stubTeamDeletionRepository } from './program-teams.service.test-support';
import { TeamsErrorCode } from '../domain/teams-error-code.enum';

const PROGRAM_ID = 'synthetic-program';
const TEAM_ID = 'synthetic-team';
const JOIN_CODE_SECRET = 'synthetic-staff-detail-secret';
const STAFF_GITHUB_ID = 5301n;

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

function buildService(overrides: {
  readonly detail?: StaffTeamDetailRecord | null;
  readonly actor?: AuthorityActor | null;
}) {
  const findStaffTeamDetail = jest
    .fn()
    .mockResolvedValue(
      overrides.detail === undefined ? null : overrides.detail,
    );
  const findActorByGithubId = jest
    .fn()
    .mockResolvedValue(
      overrides.actor === undefined ? STAFF_USER : overrides.actor,
    );
  const repository = {
    findStaffTeamDetail,
  } as unknown as ProgramTeamsRepository;
  const deletionRepository = stubTeamDeletionRepository();
  const service = new ProgramTeamsService(
    repository,
    loadRuntimeConfig({ TEAM_JOIN_CODE_SECRET: JOIN_CODE_SECRET }),
    { record: jest.fn() } as unknown as AuditLogService,
    deletionRepository,
    new UsersAuthorityService({ findActorByGithubId }),
  );
  return {
    service,
    findStaffTeamDetail,
    findActorByGithubId,
    readScopeCounts: jest.spyOn(deletionRepository, 'readScopeCounts'),
  };
}

describe('ProgramTeamsService.getForStaff', () => {
  it('팀장을 멤버 배열 맨 앞으로 올리고 신청이 없으면 application: null', async () => {
    const { service } = buildService({
      detail: {
        id: TEAM_ID,
        name: '오픈소스팀',
        leaderId: 'user-b',
        repositoryContributions: null,
        repositoryUrlHistory: { items: [], nextCursor: null },
        members: [
          { userId: 'user-a', nickname: 'login-a', name: '가나다' },
          { userId: 'user-b', nickname: 'login-b', name: '라마바' },
        ],
        application: null,
      },
    });

    const detail = await service.getForStaff(
      STAFF_GITHUB_ID,
      PROGRAM_ID,
      TEAM_ID,
    );

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
        repositoryContributions: null,
        repositoryUrlHistory: { items: [], nextCursor: null },
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

    const detail = await service.getForStaff(
      STAFF_GITHUB_ID,
      PROGRAM_ID,
      TEAM_ID,
    );

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
      service.getForStaff(STAFF_GITHUB_ID, PROGRAM_ID, TEAM_ID),
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
        repositoryContributions: null,
        repositoryUrlHistory: { items: [], nextCursor: null },
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
          await service.getForStaff(STAFF_GITHUB_ID, PROGRAM_ID, TEAM_ID),
        ),
      ),
    );

    expect(payload).toEqual({
      teamId: TEAM_ID,
      name: '오픈소스팀',
      repositoryContributions: null,
      repositoryUrlHistory: { items: [], nextCursor: null },
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

      deletionScope: {
        applications: 0,
        members: 0,
        invitations: 0,
        submissions: 0,
        submissionEvents: 0,
        detachedRepositories: 0,
        scopeFingerprint: '0'.repeat(32),
      },
    });

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

describe('ProgramTeamsService.getForStaff 권한', () => {
  const DETAIL: StaffTeamDetailRecord = {
    id: TEAM_ID,
    name: '오픈소스팀',
    leaderId: 'user-a',
    repositoryContributions: null,
    repositoryUrlHistory: { items: [], nextCursor: null },
    members: [{ userId: 'user-a', nickname: 'login-a', name: '가나다' }],
    application: null,
  };

  it.each([
    ['STAFF', STAFF_USER],
    ['ADMIN', ADMIN_USER],
  ] as const)(
    'ACTIVE %s 는 세션 식별자로 권한을 확인한 뒤 상세를 읽는다',
    async (_label, actor) => {
      const {
        service,
        findActorByGithubId,
        findStaffTeamDetail,
        readScopeCounts,
      } = buildService({ actor, detail: DETAIL });

      const detail = await service.getForStaff(
        STAFF_GITHUB_ID,
        PROGRAM_ID,
        TEAM_ID,
      );

      expect(detail.teamId).toBe(TEAM_ID);
      expect(findActorByGithubId).toHaveBeenCalledWith(STAFF_GITHUB_ID);
      expect(findStaffTeamDetail).toHaveBeenCalledWith(PROGRAM_ID, TEAM_ID);
      expect(readScopeCounts).toHaveBeenCalledWith(TEAM_ID);
    },
  );

  it.each([
    ['STUDENT', STUDENT_USER],
    ['비활성 STAFF', INACTIVE_STAFF_USER],
    ['없는 계정', null],
  ] as const)(
    '%s 은 팀 조회 전에 403 TEAM_003 으로 막힌다',
    async (_label, actor) => {
      const {
        service,
        findActorByGithubId,
        findStaffTeamDetail,
        readScopeCounts,
      } = buildService({ actor, detail: DETAIL });

      await expect(
        service.getForStaff(STAFF_GITHUB_ID, PROGRAM_ID, TEAM_ID),
      ).rejects.toMatchObject({
        errorCode: { code: TeamsErrorCode.STAFF_ONLY, status: 403 },
      });
      expect(findActorByGithubId).toHaveBeenCalledWith(STAFF_GITHUB_ID);
      expect(findStaffTeamDetail).not.toHaveBeenCalled();
      expect(readScopeCounts).not.toHaveBeenCalled();
    },
  );
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
      contribution: { groupBy: jest.fn().mockResolvedValue([]) },
      githubRepositoryOutsiderContribution: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      auditLog: { findMany: jest.fn().mockResolvedValue([]) },
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
          {
            userId: 'user-a',
            user: { githubId: 101n, nickname: 'login-a', name: '가나다' },
          },
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
          {
            userId: 'user-a',
            user: { githubId: 101n, nickname: 'login-a', name: '가나다' },
          },
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
          lastSuccessAt: null,
          failureCount: 0,
        },
        program: {
          repositoryProvisioningEnabled: true,
          startAt: new Date('2026-08-01T00:00:00.000Z'),
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
