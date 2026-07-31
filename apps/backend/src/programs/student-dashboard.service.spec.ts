import {
  ApplicationStatus,
  RepositoryInvitationStatus,
  RepositoryProvisionJobStatus,
  SubmissionStatus,
} from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { StudentDashboardService } from './student-dashboard.service';

const DUE_AT = new Date('2026-08-01T00:00:00.000Z');

function application(overrides: Record<string, unknown> = {}) {
  return {
    id: 'application-1',
    status: ApplicationStatus.APPROVED,
    teamId: null,
    applicant: { name: 'Synthetic Applicant', nickname: 'synthetic' },
    team: null,
    program: {
      id: 'program-1',
      name: 'Synthetic Program',
      milestones: [
        { id: 'milestone-1', name: 'First milestone', dueAt: DUE_AT },
      ],
    },
    submissions: [],
    provisionJob: null,
    ...overrides,
  };
}

describe('StudentDashboardService', () => {
  const findMany = jest.fn();
  const findUnique = jest.fn().mockResolvedValue({ nickname: 'synthetic' });
  const prisma = {
    user: { findUnique },
    application: { findMany },
  } as unknown as PrismaService;
  const service = new StudentDashboardService(prisma);

  beforeEach(() => {
    jest.clearAllMocks();
    findUnique.mockResolvedValue({ nickname: 'synthetic' });
  });

  it('returns no items when the session github id has no matching user', async () => {
    findUnique.mockResolvedValueOnce(null);

    await expect(service.getStudentDashboard(404n)).resolves.toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('maps owned personal and team applications and queries no other ownership paths', async () => {
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

    expect(items).toEqual([
      expect.objectContaining({
        applicationId: 'application-1',
        applicationMode: 'PERSONAL',
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
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { teamId: null, applicant: { githubId: 101n } },
            {
              team: {
                OR: [
                  { leader: { githubId: 101n } },
                  { members: { some: { user: { githubId: 101n } } } },
                ],
              },
            },
          ],
        },
      }),
    );
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
    findMany.mockResolvedValue([
      application({
        provisionJob: {
          status: RepositoryProvisionJobStatus.SUCCEEDED,
          repository: {
            applicationId: 'application-1',
            name: 'synthetic-repository',
            url: 'https://github.com/JNU-SWCU/synthetic-repository',
            invitations: [{ status: RepositoryInvitationStatus.PENDING }],
          },
        },
      }),
    ]);

    const [item] = await service.getStudentDashboard(101n);

    expect(item?.repository).toEqual({
      repositoryName: 'synthetic-repository',
      provisionStatus: 'SUCCEEDED',
      invitationStatus: 'PENDING',
      githubUrl: 'https://github.com/JNU-SWCU/synthetic-repository',
    });
  });

  it('fails closed when a successful job points at an invalid repository', async () => {
    findMany.mockResolvedValue([
      application({
        provisionJob: {
          status: RepositoryProvisionJobStatus.SUCCEEDED,
          repository: {
            applicationId: 'another-application',
            name: 'synthetic-repository',
            url: 'https://github.com/JNU-SWCU/synthetic-repository',
            invitations: [],
          },
        },
      }),
    ]);

    const [item] = await service.getStudentDashboard(101n);

    expect(item?.repository).toEqual({
      repositoryName: null,
      provisionStatus: 'FAILED_FINAL',
      invitationStatus: null,
      githubUrl: null,
    });
  });
});
