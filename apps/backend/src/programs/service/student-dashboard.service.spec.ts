import {
  ApplicationStatus,
  RepositoryInvitationStatus,
  RepositoryProvisionJobStatus,
  SubmissionStatus,
} from '@prisma/client';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import {
  REPOSITORIES_READ_PORT,
  type RepositoriesReadPort,
} from '../../github/repositories-read.port';
import { StudentDashboardService } from './student-dashboard.service';

const DUE_AT = new Date('2026-08-01T00:00:00.000Z');

function application(overrides: Record<string, unknown> = {}) {
  return {
    id: 'application-1',
    status: ApplicationStatus.APPROVED,
    // D5: 개인 참여 = 1인 팀. teamId/team은 항상 있다.
    teamId: 'solo-team-1',
    applicant: { name: 'Synthetic Applicant', nickname: 'synthetic' },
    team: { name: 'Synthetic Applicant' },
    program: {
      id: 'program-1',
      name: 'Synthetic Program',
      milestones: [
        { id: 'milestone-1', name: 'First milestone', dueAt: DUE_AT },
      ],
    },
    submissions: [],
    ...overrides,
  };
}

describe('StudentDashboardService', () => {
  const findMany = jest.fn();
  const prisma = {
    application: { findMany },
  } as unknown as PrismaService;
  const getMyRepositories = jest.fn();
  const repositories = {
    getMyRepositories,
  } as RepositoriesReadPort;
  const service = new StudentDashboardService(prisma, repositories);

  beforeEach(() => {
    jest.clearAllMocks();
    findMany.mockResolvedValue([]);
    getMyRepositories.mockResolvedValue([]);
  });

  it('returns no items when the student owns no applications', async () => {
    await expect(service.getStudentDashboard(404n)).resolves.toEqual([]);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(getMyRepositories).toHaveBeenCalledWith(404n);
  });

  it('compiles with the DTO-only repositories read-port token', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        StudentDashboardService,
        {
          provide: PrismaService,
          useValue: { application: { findMany: jest.fn() } },
        },
        {
          provide: REPOSITORIES_READ_PORT,
          useValue: { getMyRepositories: jest.fn() },
        },
      ],
    }).compile();

    expect(moduleRef.get(StudentDashboardService)).toBeInstanceOf(
      StudentDashboardService,
    );
  });

  it('maps owned solo-team and multi-member team applications and queries team membership only', async () => {
    findMany.mockResolvedValue([
      application(),
      application({
        id: 'application-2',
        teamId: 'team-1',
        applicant: { name: 'Other applicant', nickname: 'other' },
        team: { name: 'Synthetic Team' },
      }),
    ]);

    const items = await service.getStudentDashboard(101n);

    // D5: teamId non-null → applicationMode는 항상 TEAM. displayName은 team.name.
    expect(items).toEqual([
      expect.objectContaining({
        applicationId: 'application-1',
        applicationMode: 'TEAM',
        displayName: 'Synthetic Applicant',
        detailUrl: '/programs/program-1',
        checklistUrl: '/programs/program-1/submissions',
      }),
      expect.objectContaining({
        applicationId: 'application-2',
        applicationMode: 'TEAM',
        displayName: 'Synthetic Team',
      }),
    ]);
    expect(items[0]?.repository?.provisionStatus).toBe('NOT_STARTED');
    expect(getMyRepositories).toHaveBeenCalledWith(101n);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          // production student-dashboard.service.ts — 팀 소속 하나로 판정(D5).
          team: {
            OR: [
              { leader: { githubId: 101n } },
              { members: { some: { user: { githubId: 101n } } } },
            ],
          },
        },
      }),
    );
  });

  /**
   * 카드가 학생을 **어디로 보내는지**. 이 단언이 없는 동안 `detailUrl`은 아무 곳이나
   * 가리켜도 모든 테스트가 초록불이었고, 그래서 반려된 학생이 사유도 신청 상태도 없는
   * 프로그램 상세로 가는 것을 아무도 잡지 못했다(#733).
   *
   * frontend 검증기(`features/dashboard/api.ts`)가 같은 규칙을 반대편에서 **글자 그대로**
   * 강제한다 — 한쪽만 바뀌면 검증기가 던져서 그 학생의 대시보드가 통째로 오류 화면이 된다.
   * 그래서 세 상태를 전부 고정한다. 하나만 고정하면 나머지가 조용히 갈릴 수 있다.
   */
  it.each([
    [ApplicationStatus.SUBMITTED, '/programs/program-1/apply'],
    [ApplicationStatus.REJECTED, '/programs/program-1/apply'],
    [ApplicationStatus.APPROVED, '/programs/program-1'],
  ])('points a %s application at %s', async (status, detailUrl) => {
    findMany.mockResolvedValue([application({ status })]);

    const [item] = await service.getStudentDashboard(101n);

    expect(item?.detailUrl).toBe(detailUrl);
  });

  it('keeps nextMilestone null for applications that are not approved', async () => {
    findMany.mockResolvedValue([
      application({ status: ApplicationStatus.SUBMITTED }),
    ]);

    const [item] = await service.getStudentDashboard(101n);

    expect(item?.nextMilestone).toBeNull();
  });

  it('skips approved milestones and returns null when all milestones are approved', async () => {
    findMany.mockResolvedValue([
      application({
        program: {
          id: 'program-1',
          name: 'Synthetic Program',
          milestones: [
            { id: 'milestone-1', name: 'First', dueAt: DUE_AT },
            {
              id: 'milestone-2',
              name: 'Second',
              dueAt: new Date('2026-08-02T00:00:00.000Z'),
            },
          ],
        },
        submissions: [
          { milestoneId: 'milestone-1', status: SubmissionStatus.APPROVED },
          {
            milestoneId: 'milestone-2',
            status: SubmissionStatus.CHANGES_REQUESTED,
          },
        ],
      }),
      application({
        id: 'application-2',
        submissions: [
          { milestoneId: 'milestone-1', status: SubmissionStatus.APPROVED },
        ],
      }),
    ]);

    const items = await service.getStudentDashboard(101n);

    expect(items[0]?.nextMilestone).toMatchObject({
      id: 'milestone-2',
      submissionStatus: 'CHANGES_REQUESTED',
    });
    expect(items[1]?.nextMilestone).toBeNull();
  });

  it('treats a missing submission as NOT_SUBMITTED', async () => {
    findMany.mockResolvedValue([application()]);

    const [item] = await service.getStudentDashboard(101n);

    expect(item?.nextMilestone).toEqual({
      id: 'milestone-1',
      name: 'First milestone',
      dueAt: DUE_AT,
      submissionStatus: 'NOT_SUBMITTED',
    });
  });

  it('maps a validated successful repository and current-user invitation', async () => {
    findMany.mockResolvedValue([application()]);
    getMyRepositories.mockResolvedValue([
      {
        applicationId: 'application-1',
        repositoryName: 'synthetic-repository',
        provisionStatus: RepositoryProvisionJobStatus.SUCCEEDED,
        invitationStatus: RepositoryInvitationStatus.PENDING,
        githubUrl: 'https://github.com/JNU-SWCU/synthetic-repository',
      },
    ]);

    const [item] = await service.getStudentDashboard(101n);

    expect(item?.repository).toEqual({
      repositoryName: 'synthetic-repository',
      provisionStatus: 'SUCCEEDED',
      invitationStatus: 'PENDING',
      githubUrl: 'https://github.com/JNU-SWCU/synthetic-repository',
    });
  });

  it('reuses the canonical pre-success repository projection', async () => {
    findMany.mockResolvedValue([application()]);
    getMyRepositories.mockResolvedValue([
      {
        applicationId: 'application-1',
        repositoryName: null,
        provisionStatus: RepositoryProvisionJobStatus.PROCESSING,
        invitationStatus: null,
        githubUrl: null,
      },
    ]);

    const [item] = await service.getStudentDashboard(101n);

    expect(item?.repository).toEqual({
      repositoryName: null,
      provisionStatus: 'PROCESSING',
      invitationStatus: null,
      githubUrl: null,
    });
  });
  it('distinguishes retryable and final provisioning failures without exposing raw errors', async () => {
    findMany.mockResolvedValue([
      application(),
      application({ id: 'application-2' }),
    ]);
    getMyRepositories.mockResolvedValue([
      {
        applicationId: 'application-1',
        repositoryName: null,
        provisionStatus: RepositoryProvisionJobStatus.FAILED_RETRYABLE,
        invitationStatus: null,
        githubUrl: null,
        lastErrorCode: 'raw upstream response that must not be exposed',
      },
      {
        applicationId: 'application-2',
        repositoryName: null,
        provisionStatus: RepositoryProvisionJobStatus.FAILED_FINAL,
        invitationStatus: null,
        githubUrl: null,
        lastErrorCode: 'raw upstream response that must not be exposed',
      },
    ]);

    const items = await service.getStudentDashboard(101n);

    expect(items.map((item) => item.repository?.provisionStatus)).toEqual([
      'FAILED_RETRYABLE',
      'FAILED_FINAL',
    ]);
    expect(JSON.stringify(items)).not.toContain(
      'raw upstream response that must not be exposed',
    );
  });

  it('fails closed when repository creation succeeded without current-user invitation evidence', async () => {
    findMany.mockResolvedValue([application()]);
    getMyRepositories.mockResolvedValue([
      {
        applicationId: 'application-1',
        repositoryName: 'synthetic-repository',
        provisionStatus: RepositoryProvisionJobStatus.SUCCEEDED,
        invitationStatus: null,
        githubUrl: 'https://github.com/JNU-SWCU/synthetic-repository',
      },
    ]);

    const [item] = await service.getStudentDashboard(101n);

    expect(item?.repository).toEqual({
      repositoryName: 'synthetic-repository',
      provisionStatus: 'SUCCEEDED',
      invitationStatus: 'FAILED_FINAL',
      githubUrl: 'https://github.com/JNU-SWCU/synthetic-repository',
    });
  });
});
