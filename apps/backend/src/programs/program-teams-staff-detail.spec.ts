import { StudentRepositoryUrlService } from './team-application.service';
import { PlatformRepository } from '../platform/platform.repository';
import { TeamHistoryRepository } from './team-history.repository';
import { ProgramTeamRepositoryEvidenceRepository } from './program-team-repository-evidence.repository';
import { AccountStatus, RepositoryProvisionJobStatus } from '@prisma/client';
import { StaffTeamDetailResponseDto } from './dto/staff-team-detail-response.dto';
import { TeamRepository, type StaffTeamDetailRecord } from './team.repository';
import { TeamMembershipService } from './team-membership.service';
import { stubTeamDeletionRepository } from './program-teams.service.test-support';
import { TeamsErrorCode } from './teams.error';
import { HistoryMetadataService } from '../platform/history-metadata.service';
import { RepositoryPublishService } from '../github/repository-publish.service';
import { RepositoryUrlService } from '../github/repository-url.service';
import { MilestoneCompletionService } from './submissions.service';

const PROGRAM_ID = 'synthetic-program';
const TEAM_ID = 'synthetic-team';

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
  } as unknown as TeamRepository;
  const deletionRepository = stubTeamDeletionRepository();
  const service = new TeamMembershipService(
    repository,
    deletionRepository,
    new HistoryMetadataService(),
    new RepositoryPublishService(),
    new RepositoryUrlService(),
    new MilestoneCompletionService(),
    new StudentRepositoryUrlService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    ),
  );
  return {
    service,
    findStaffTeamDetail,
    findActorByGithubId,
    readScopeCounts: jest.spyOn(deletionRepository, 'readScopeCounts'),
  };
}

describe('TeamMembershipService.getForStaff', () => {
  it.each([
    RepositoryProvisionJobStatus.FAILED_RETRYABLE,
    RepositoryProvisionJobStatus.FAILED_FINAL,
  ])(
    'returns the original provisioning status %s without an API alias',
    async (status) => {
      const { service } = buildService({
        detail: {
          repositoryContributions: null,
          repositoryUrlHistory: { rows: [], hasMore: false },
          id: TEAM_ID,
          name: 'synthetic team',
          leaderId: 'synthetic-leader',
          members: [],
          application: {
            id: 'synthetic-application',
            status: 'APPROVED',
            repositoryConnectionMode: 'NEW',
            isRepositoryPublicationPlanned: false,
            submissions: [],
            repository: null,
            updatedAt: new Date('2026-08-09T00:00:00Z'),
            job: {
              repoId: null,
              status,
              updatedAt: new Date('2026-08-09T00:00:00Z'),
              lastErrorCode: 'GITHUB_OPERATIONS_RATE_LIMITED',
            },
            outbox: {
              status: 'PROCESSED',
              createdAt: new Date('2026-08-09T00:00:00Z'),
            },
            program: {
              repositoryProvisioningEnabled: true,
              endAt: new Date('2026-12-31T00:00:00Z'),
              milestones: [],
            },
          },
        },
      });

      const result = await service.getForStaff(PROGRAM_ID, TEAM_ID);

      expect(result.application?.repositoryProvisioning.jobStatus).toBe(status);
    },
  );

  it('팀장을 멤버 배열 맨 앞으로 올리고 신청이 없으면 application: null', async () => {
    const { service } = buildService({
      detail: {
        id: TEAM_ID,
        name: '오픈소스팀',
        leaderId: 'user-b',
        repositoryContributions: null,
        repositoryUrlHistory: { rows: [], hasMore: false },
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
        repositoryContributions: null,
        repositoryUrlHistory: { rows: [], hasMore: false },
        members: [{ userId: 'user-a', nickname: 'login-a', name: '가나다' }],
        application: {
          id: 'application-1',
          status: 'APPROVED',
          repositoryConnectionMode: 'OWN',
          updatedAt: new Date('2026-08-01T00:00:00.000Z'),
          isRepositoryPublicationPlanned: true,
          repository: {
            githubRepositoryId: 1n,
            nameWithOwner: 'org/repo',
            visibility: 'PUBLIC',
          },
          program: {
            endAt: new Date('2026-08-01T00:00:00.000Z'),
            repositoryProvisioningEnabled: true,
            milestones: [],
          },
          submissions: [],
          outbox: null,
          job: {
            status: 'SUCCEEDED',
            updatedAt: new Date('2026-08-01T00:00:00.000Z'),
            lastErrorCode: null,
            repoId: 1n,
          },
        },
      },
    });

    const detail = await service.getForStaff(PROGRAM_ID, TEAM_ID);

    expect(detail.application).toEqual({
      id: 'application-1',
      status: 'APPROVED',
      repositoryConnectionMode: 'OWN',
      repository: {
        id: '1',
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
        repositoryContributions: null,
        repositoryUrlHistory: { rows: [], hasMore: false },
        members: [{ userId: 'user-a', nickname: 'login-a', name: '가나다' }],
        application: {
          id: 'application-1',
          status: 'SUBMITTED',
          repositoryConnectionMode: 'NEW',
          updatedAt: new Date('2026-08-01T00:00:00.000Z'),
          isRepositoryPublicationPlanned: true,
          repository: null,
          program: {
            endAt: new Date('2026-08-01T00:00:00.000Z'),
            repositoryProvisioningEnabled: true,
            milestones: [],
          },
          submissions: [],
          outbox: null,
          job: null,
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
        teams: 0,
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

describe('TeamRepository.findStaffTeamDetail', () => {
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
    readonly team?: object | null;
    readonly application?: object | null;
    readonly outbox?: unknown;
    readonly job?: unknown;
  }) {
    const teamFindFirst = jest
      .fn<Promise<unknown>, [unknown]>()
      .mockResolvedValue(
        overrides.team == null
          ? null
          : {
              status: 'SUBMITTED',
              updatedAt: new Date('2026-08-01'),
              repositoryConnectionMode: 'NEW',
              isRepositoryPublicationPlanned: false,
              teamRepos: [],
              program: {
                endAt: new Date('2099-01-01'),
                repositoryProvisioningEnabled: false,
                milestones: [],
              },
              submissions: [],
              ...(overrides.application ?? {}),
              ...(overrides.team ?? {}),
            },
      );
    const outboxFindUnique = jest
      .fn()
      .mockResolvedValue(overrides.outbox ?? null);
    const jobFindUnique = jest.fn().mockResolvedValue(overrides.job ?? null);
    const prisma = {
      team: { findFirst: teamFindFirst },
      outboxEvent: { findUnique: outboxFindUnique },
      repositoryProvisionJob: { findUnique: jobFindUnique },
      contribution: { groupBy: jest.fn().mockResolvedValue([]) },
      repo: { findUnique: jest.fn().mockResolvedValue(null) },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    return {
      repository: new TeamRepository(
        prisma as never,
        new ProgramTeamRepositoryEvidenceRepository(prisma as never),
        new PlatformRepository(),
        new TeamHistoryRepository(),
      ),
      teamFindFirst,
    };
  }

  it('팀을 programId+teamId 로 조회해 다른 프로그램의 teamId 는 걸러낸다', async () => {
    const { repository, teamFindFirst } = buildRepository({ team: null });

    const result = await repository.findStaffTeamDetail(PROGRAM_ID, TEAM_ID);

    expect(result).toBeNull();
    expect(teamFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: TEAM_ID, programId: PROGRAM_ID, archivedAt: null },
      }),
    );
  });

  it('지원 상태를 같은 Team 조회에서 읽는다', async () => {
    const { repository, teamFindFirst } = buildRepository({
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

    expect(result?.application).toMatchObject({
      id: TEAM_ID,
      status: 'SUBMITTED',
    });
    expect(teamFindFirst).toHaveBeenCalledTimes(1);
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
        teamRepos: [
          {
            repo: {
              githubRepoId: 1n,
              ownerName: 'org/repo',
              visibility: 'PRIVATE',
            },
          },
        ],
        program: {
          repositoryProvisioningEnabled: true,
          startAt: new Date('2026-08-01T00:00:00.000Z'),
          endAt: new Date('2026-08-12T00:00:00.000Z'),
          milestones: [
            { id: 'milestone-1', requirements: [{ id: 'document-1' }] },
          ],
        },
        submissions: [
          {
            status: 'APPROVED',
            requirement: {
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
        repoId: 1n,
      },
    });

    const result = await repository.findStaffTeamDetail(PROGRAM_ID, TEAM_ID);

    expect(
      new TeamMembershipService(
        undefined as never,
        undefined as never,
        new HistoryMetadataService(),
        new RepositoryPublishService(),
        new RepositoryUrlService(),
        new MilestoneCompletionService(),
        new StudentRepositoryUrlService(
          {} as never,
          {} as never,
          {} as never,
          {} as never,
          {} as never,
          {} as never,
        ),
      )['toTeamApplicationView'](result!.application!).repository,
    ).toMatchObject({
      id: '1',
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
