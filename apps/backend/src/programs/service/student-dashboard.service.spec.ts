import {
  ApplicationStatus,
  MilestoneDocumentKind,
  MilestoneSubmissionType,
  type Prisma,
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
import { submissionCompletionTargetSelect } from '../../submissions/submission-completion-projection';
import {
  StudentDashboardReadRepository,
  type StudentDashboardApplicationRow,
} from '../repository/student-dashboard-read.repository';
import { StudentDashboardService } from './student-dashboard.service';

const DUE_AT = new Date('2026-08-01T00:00:00.000Z');
const SECOND_DUE_AT = new Date('2026-08-02T00:00:00.000Z');

function legacySubmission(milestoneId: string, status: SubmissionStatus) {
  return {
    status,
    milestoneDocument: {
      id: `${milestoneId}-legacy-slot`,
      milestoneId,
      kind: MilestoneDocumentKind.LEGACY_MILESTONE_SUBMISSION,
    },
  };
}

function documentSubmission(
  milestoneId: string,
  documentId: string,
  status: SubmissionStatus,
) {
  return {
    status,
    milestoneDocument: {
      id: documentId,
      milestoneId,
      kind: MilestoneDocumentKind.DOCUMENT,
    },
  };
}

function legacyMilestone(id: string, name: string, dueAt: Date) {
  return {
    id,
    name,
    dueAt,
    submissionType: MilestoneSubmissionType.FILE,
    documents: [],
  };
}

function documentMilestone(
  id: string,
  name: string,
  dueAt: Date,
  requiredDocumentIds: readonly string[],
) {
  return {
    id,
    name,
    dueAt,
    submissionType: null,
    documents: requiredDocumentIds.map((documentId) => ({ id: documentId })),
  };
}

function program(
  milestones: readonly StudentDashboardApplicationRow['program']['milestones'][number][],
  id = 'program-1',
) {
  return { id, name: 'Synthetic Program', milestones };
}

function application(
  overrides: Partial<StudentDashboardApplicationRow> = {},
): StudentDashboardApplicationRow {
  return {
    id: 'application-1',
    status: ApplicationStatus.APPROVED,

    team: { name: 'Synthetic Solo Team' },
    program: program([
      legacyMilestone('milestone-1', 'First milestone', DUE_AT),
    ]),
    milestoneDocumentSubmissions: [],
    ...overrides,
  };
}

describe('StudentDashboardService', () => {
  const findParticipatingApplications = jest.fn();
  const repository = {
    findParticipatingApplications,
  } as unknown as StudentDashboardReadRepository;
  const getMyRepositories = jest.fn();
  const repositories = {
    getMyRepositories,
  } as RepositoriesReadPort;
  const service = new StudentDashboardService(repository, repositories);

  beforeEach(() => {
    jest.clearAllMocks();
    findParticipatingApplications.mockResolvedValue([]);
    getMyRepositories.mockResolvedValue([]);
  });

  it('returns no items when the student is in no team', async () => {
    await expect(service.getStudentDashboard(404n)).resolves.toEqual([]);
    expect(findParticipatingApplications).toHaveBeenCalledWith(404n);
    expect(getMyRepositories).toHaveBeenCalledWith(404n);
  });

  it('projects the current program cover without storage metadata', async () => {
    findParticipatingApplications.mockResolvedValue([
      application({ program: { ...program([]), cover: { id: 'cover-1' } } }),
    ]);

    const items = await service.getStudentDashboard(404n);

    expect(items[0]?.coverImageUrl).toBe('/programs/program-1/cover/cover-1');
    expect(items[0]).not.toHaveProperty('storageKey');
  });

  it('projects an external cover directly on the student dashboard', async () => {
    const imageUrl = 'https://sojoong.kr/wp-content/uploads/synthetic.jpg';
    findParticipatingApplications.mockResolvedValue([
      application({
        program: { ...program([]), cover: { id: 'external-1', imageUrl } },
      }),
    ]);
    const items = await service.getStudentDashboard(404n);
    expect(items[0]?.coverImageUrl).toBe(imageUrl);
  });

  it('projects a null cover when the program has no cover', async () => {
    findParticipatingApplications.mockResolvedValue([application()]);

    const items = await service.getStudentDashboard(404n);

    expect(items[0]?.coverImageUrl).toBeNull();
  });

  it('compiles with the read repository and the DTO-only repositories read-port token', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        StudentDashboardService,
        StudentDashboardReadRepository,
        {
          provide: PrismaService,
          useValue: {
            user: { findUnique: jest.fn() },
            application: { findMany: jest.fn() },
          },
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

  it('gives every current member the same team name and my-team link', async () => {
    findParticipatingApplications.mockResolvedValue([
      application({ team: { name: 'Solo Team' } }),
      application({
        id: 'application-2',
        team: { name: 'Synthetic Team' },
      }),
    ]);

    const items = await service.getStudentDashboard(101n);

    expect(items).toEqual([
      expect.objectContaining({
        applicationId: 'application-1',
        teamName: 'Solo Team',
        teamUrl: '/programs/program-1/my-team',
        detailUrl: '/programs/program-1',
        checklistUrl: '/programs/program-1/submissions',
      }),
      expect.objectContaining({
        applicationId: 'application-2',
        teamName: 'Synthetic Team',
        teamUrl: '/programs/program-1/my-team',
      }),
    ]);

    expect(items[0]).not.toHaveProperty('applicationMode');
    expect(items[0]).not.toHaveProperty('displayName');
    expect(items[0]?.repository?.provisionStatus).toBe('NOT_STARTED');
  });

  it('percent-encodes the program id in every card link', async () => {
    findParticipatingApplications.mockResolvedValue([
      application({
        program: program(
          [legacyMilestone('milestone-1', 'First milestone', DUE_AT)],
          'program:1',
        ),
      }),
    ]);

    const [item] = await service.getStudentDashboard(101n);

    expect(item?.teamUrl).toBe('/programs/program%3A1/my-team');
    expect(item?.detailUrl).toBe('/programs/program%3A1');
    expect(item?.checklistUrl).toBe('/programs/program%3A1/submissions');
  });

  it('drops a card whose team name is blank instead of inventing one', async () => {
    findParticipatingApplications.mockResolvedValue([
      application({ team: { name: '   ' } }),
    ]);

    await expect(service.getStudentDashboard(101n)).resolves.toEqual([]);
  });

  it.each([
    [ApplicationStatus.SUBMITTED, '/programs/program-1/apply'],
    [ApplicationStatus.REJECTED, '/programs/program-1/apply'],
    [ApplicationStatus.APPROVED, '/programs/program-1'],
  ])('points a %s application at %s', async (status, detailUrl) => {
    findParticipatingApplications.mockResolvedValue([application({ status })]);

    const [item] = await service.getStudentDashboard(101n);

    expect(item?.detailUrl).toBe(detailUrl);

    expect(item?.teamUrl).toBe('/programs/program-1/my-team');
  });

  it('keeps nextMilestone null for applications that are not approved', async () => {
    findParticipatingApplications.mockResolvedValue([
      application({ status: ApplicationStatus.SUBMITTED }),
    ]);

    const [item] = await service.getStudentDashboard(101n);

    expect(item?.nextMilestone).toBeNull();
  });

  it('skips approved milestones and returns null when all milestones are approved', async () => {
    findParticipatingApplications.mockResolvedValue([
      application({
        program: program([
          legacyMilestone('milestone-1', 'First', DUE_AT),
          legacyMilestone('milestone-2', 'Second', SECOND_DUE_AT),
        ]),
        milestoneDocumentSubmissions: [
          legacySubmission('milestone-1', SubmissionStatus.APPROVED),
          legacySubmission('milestone-2', SubmissionStatus.CHANGES_REQUESTED),
        ],
      }),
      application({
        id: 'application-2',
        milestoneDocumentSubmissions: [
          legacySubmission('milestone-1', SubmissionStatus.APPROVED),
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

  it('holds the milestone while any required document is unapproved', async () => {
    findParticipatingApplications.mockResolvedValue([
      application({
        program: program([
          documentMilestone('milestone-1', 'First', DUE_AT, [
            'document-1',
            'document-2',
          ]),
          documentMilestone('milestone-2', 'Second', SECOND_DUE_AT, [
            'document-3',
          ]),
        ]),
        milestoneDocumentSubmissions: [
          documentSubmission(
            'milestone-1',
            'document-1',
            SubmissionStatus.SUBMITTED,
          ),
          documentSubmission(
            'milestone-1',
            'document-2',
            SubmissionStatus.APPROVED,
          ),
        ],
      }),
    ]);

    const [item] = await service.getStudentDashboard(101n);

    expect(item?.nextMilestone).toMatchObject({
      id: 'milestone-1',
      submissionStatus: 'SUBMITTED',
    });
  });

  it('advances past a milestone whose required documents are all approved', async () => {
    findParticipatingApplications.mockResolvedValue([
      application({
        program: program([
          documentMilestone('milestone-1', 'First', DUE_AT, [
            'document-1',
            'document-2',
          ]),
          documentMilestone('milestone-2', 'Second', SECOND_DUE_AT, [
            'document-3',
          ]),
        ]),
        milestoneDocumentSubmissions: [
          documentSubmission(
            'milestone-1',
            'document-1',
            SubmissionStatus.APPROVED,
          ),
          documentSubmission(
            'milestone-1',
            'document-2',
            SubmissionStatus.APPROVED,
          ),

          documentSubmission(
            'milestone-2',
            'optional-document',
            SubmissionStatus.APPROVED,
          ),
        ],
      }),
    ]);

    const [item] = await service.getStudentDashboard(101n);

    expect(item?.nextMilestone).toMatchObject({
      id: 'milestone-2',
      submissionStatus: 'NOT_SUBMITTED',
    });
  });

  it('empties nextMilestone once every milestone has its required documents approved', async () => {
    findParticipatingApplications.mockResolvedValue([
      application({
        program: program([
          documentMilestone('milestone-1', 'First', DUE_AT, ['document-1']),
          documentMilestone('milestone-2', 'Second', SECOND_DUE_AT, [
            'document-2',
          ]),
        ]),
        milestoneDocumentSubmissions: [
          documentSubmission(
            'milestone-1',
            'document-1',
            SubmissionStatus.APPROVED,
          ),
          documentSubmission(
            'milestone-2',
            'document-2',
            SubmissionStatus.APPROVED,
          ),

          documentSubmission(
            'milestone-2',
            'optional-document',
            SubmissionStatus.CHANGES_REQUESTED,
          ),
        ],
      }),
    ]);

    const [item] = await service.getStudentDashboard(101n);

    expect(item?.nextMilestone).toBeNull();
  });

  it('lets an unapproved required document outrank an approved legacy submission', async () => {
    findParticipatingApplications.mockResolvedValue([
      application({
        program: program([
          {
            ...legacyMilestone('milestone-1', 'First milestone', DUE_AT),
            documents: [{ id: 'document-1' }],
          },
        ]),
        milestoneDocumentSubmissions: [
          documentSubmission(
            'milestone-1',
            'document-1',
            SubmissionStatus.SUBMITTED,
          ),
          legacySubmission('milestone-1', SubmissionStatus.APPROVED),
        ],
      }),
    ]);

    const [item] = await service.getStudentDashboard(101n);

    expect(item?.nextMilestone).toMatchObject({
      id: 'milestone-1',
      submissionStatus: 'SUBMITTED',
    });
  });

  it('treats a missing submission as NOT_SUBMITTED', async () => {
    findParticipatingApplications.mockResolvedValue([application()]);

    const [item] = await service.getStudentDashboard(101n);

    expect(item?.nextMilestone).toEqual({
      id: 'milestone-1',
      name: 'First milestone',
      dueAt: DUE_AT,
      submissionStatus: 'NOT_SUBMITTED',
      requiredItemCount: 1,
      remainingItemCount: 1,
    });
  });

  it('counts approved and in-review milestones against every milestone with a required item', async () => {
    findParticipatingApplications.mockResolvedValue([
      application({
        program: program([
          documentMilestone('milestone-1', 'Approved', DUE_AT, [
            'document-1',
            'document-2',
          ]),
          documentMilestone('milestone-2', 'Partly approved', DUE_AT, [
            'document-3',
            'document-4',
          ]),
          legacyMilestone('milestone-3', 'Legacy in review', DUE_AT),
          documentMilestone('milestone-4', 'Not started', DUE_AT, [
            'document-5',
          ]),
        ]),
        milestoneDocumentSubmissions: [
          documentSubmission(
            'milestone-1',
            'document-1',
            SubmissionStatus.APPROVED,
          ),
          documentSubmission(
            'milestone-1',
            'document-2',
            SubmissionStatus.APPROVED,
          ),
          documentSubmission(
            'milestone-2',
            'document-3',
            SubmissionStatus.APPROVED,
          ),
          documentSubmission(
            'milestone-2',
            'document-4',
            SubmissionStatus.SUBMITTED,
          ),
          legacySubmission('milestone-3', SubmissionStatus.SUBMITTED),
        ],
      }),
    ]);

    const [item] = await service.getStudentDashboard(101n);

    expect(item?.progress).toEqual({
      approvedCount: 1,
      inReviewCount: 2,
      totalCount: 4,
    });
  });

  it('leaves information-only milestones out of every progress count', async () => {
    findParticipatingApplications.mockResolvedValue([
      application({
        program: program([
          documentMilestone('milestone-1', 'Information only', DUE_AT, []),
          documentMilestone('milestone-2', 'Approved', SECOND_DUE_AT, [
            'document-1',
          ]),
        ]),
        milestoneDocumentSubmissions: [
          documentSubmission(
            'milestone-1',
            'optional-document',
            SubmissionStatus.APPROVED,
          ),
          documentSubmission(
            'milestone-2',
            'document-1',
            SubmissionStatus.APPROVED,
          ),
        ],
      }),
    ]);

    const [item] = await service.getStudentDashboard(101n);

    expect(item?.progress).toEqual({
      approvedCount: 1,
      inReviewCount: 0,
      totalCount: 1,
    });
  });

  it('skips information-only milestones when choosing the next milestone', async () => {
    findParticipatingApplications.mockResolvedValue([
      application({
        program: program([
          documentMilestone('milestone-1', 'Information only', DUE_AT, []),
          documentMilestone('milestone-2', 'Report', SECOND_DUE_AT, [
            'document-1',
          ]),
        ]),
      }),
    ]);

    const [item] = await service.getStudentDashboard(101n);

    expect(item?.nextMilestone).toMatchObject({ id: 'milestone-2' });
  });

  it('finishes the card when only information-only milestones are left', async () => {
    findParticipatingApplications.mockResolvedValue([
      application({
        program: program([
          documentMilestone('milestone-1', 'Report', DUE_AT, ['document-1']),
          documentMilestone('milestone-2', 'Closing notice', SECOND_DUE_AT, []),
        ]),
        milestoneDocumentSubmissions: [
          documentSubmission(
            'milestone-1',
            'document-1',
            SubmissionStatus.APPROVED,
          ),
        ],
      }),
    ]);

    const [item] = await service.getStudentDashboard(101n);

    expect(item?.nextMilestone).toBeNull();
    expect(item?.progress).toEqual({
      approvedCount: 1,
      inReviewCount: 0,
      totalCount: 1,
    });
  });

  it('counts rejected, changes-requested and unsubmitted milestones only in the total', async () => {
    findParticipatingApplications.mockResolvedValue([
      application({
        program: program([
          documentMilestone('milestone-1', 'Rejected', DUE_AT, [
            'document-1',
            'document-2',
          ]),
          documentMilestone('milestone-2', 'Changes requested', DUE_AT, [
            'document-3',
            'document-4',
          ]),
          documentMilestone('milestone-3', 'Not submitted', DUE_AT, [
            'document-5',
          ]),
        ]),
        milestoneDocumentSubmissions: [
          documentSubmission(
            'milestone-1',
            'document-1',
            SubmissionStatus.APPROVED,
          ),
          documentSubmission(
            'milestone-1',
            'document-2',
            SubmissionStatus.REJECTED,
          ),
          documentSubmission(
            'milestone-2',
            'document-3',
            SubmissionStatus.SUBMITTED,
          ),
          documentSubmission(
            'milestone-2',
            'document-4',
            SubmissionStatus.CHANGES_REQUESTED,
          ),
        ],
      }),
    ]);

    const [item] = await service.getStudentDashboard(101n);

    expect(item?.progress).toEqual({
      approvedCount: 0,
      inReviewCount: 0,
      totalCount: 3,
    });
  });

  it('counts the next milestone items the student still has to send', async () => {
    findParticipatingApplications.mockResolvedValue([
      application({
        program: program([
          documentMilestone('milestone-1', 'First', DUE_AT, [
            'document-1',
            'document-2',
            'document-3',
            'document-4',
            'document-5',
          ]),
        ]),
        milestoneDocumentSubmissions: [
          documentSubmission(
            'milestone-1',
            'document-1',
            SubmissionStatus.APPROVED,
          ),
          documentSubmission(
            'milestone-1',
            'document-2',
            SubmissionStatus.SUBMITTED,
          ),
          documentSubmission(
            'milestone-1',
            'document-3',
            SubmissionStatus.CHANGES_REQUESTED,
          ),
          documentSubmission(
            'milestone-1',
            'document-4',
            SubmissionStatus.REJECTED,
          ),
        ],
      }),
    ]);

    const [item] = await service.getStudentDashboard(101n);

    expect(item?.nextMilestone).toMatchObject({
      id: 'milestone-1',
      requiredItemCount: 5,
      remainingItemCount: 2,
    });
  });

  it.each([ApplicationStatus.SUBMITTED, ApplicationStatus.REJECTED])(
    'leaves progress null for a %s application',
    async (status) => {
      findParticipatingApplications.mockResolvedValue([
        application({
          status,
          milestoneDocumentSubmissions: [
            legacySubmission('milestone-1', SubmissionStatus.APPROVED),
          ],
        }),
      ]);

      const [item] = await service.getStudentDashboard(101n);

      expect(item?.progress).toBeNull();
    },
  );

  it('maps a validated successful repository and current-user invitation', async () => {
    findParticipatingApplications.mockResolvedValue([application()]);
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
    findParticipatingApplications.mockResolvedValue([application()]);
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
    findParticipatingApplications.mockResolvedValue([
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
    findParticipatingApplications.mockResolvedValue([application()]);
    getMyRepositories.mockResolvedValue([
      {
        applicationId: 'application-1',
        connectionMode: 'NEW',
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

  it('keeps a successful OWN repository complete without an organization invitation', async () => {
    findParticipatingApplications.mockResolvedValue([application()]);
    getMyRepositories.mockResolvedValue([
      {
        applicationId: 'application-1',
        connectionMode: 'OWN',
        repositoryName: 'synthetic-repository',
        provisionStatus: RepositoryProvisionJobStatus.SUCCEEDED,
        invitationStatus: null,
        githubUrl: 'https://github.com/synthetic-owner/synthetic-repository',
      },
    ]);

    const [item] = await service.getStudentDashboard(101n);

    expect(item?.repository).toEqual({
      repositoryName: 'synthetic-repository',
      provisionStatus: 'SUCCEEDED',
      invitationStatus: null,
      githubUrl: 'https://github.com/synthetic-owner/synthetic-repository',
    });
  });
});

describe('StudentDashboardReadRepository', () => {
  const findUnique = jest.fn();
  const findMany = jest.fn();
  const prisma = {
    user: { findUnique },
    application: { findMany },
  } as unknown as PrismaService;
  const repository = new StudentDashboardReadRepository(prisma);

  beforeEach(() => {
    jest.clearAllMocks();
    findUnique.mockResolvedValue({ id: 'user-1' });
    findMany.mockResolvedValue([]);
  });

  it('narrows applications to current TeamMember rows only', async () => {
    await repository.findParticipatingApplications(101n);

    expect(findUnique).toHaveBeenCalledWith({
      where: { githubId: 101n },
      select: { id: true },
    });
    const [args] = findMany.mock.calls[0] as [Prisma.ApplicationFindManyArgs];
    expect(args.where).toEqual({
      team: { members: { some: { userId: 'user-1' } } },
    });
    expect(JSON.stringify(args.where)).not.toContain('applicant');
    expect(JSON.stringify(args.where)).not.toContain('leader');
  });

  it('returns nothing and never queries applications for an unknown session user', async () => {
    findUnique.mockResolvedValue(null);

    await expect(
      repository.findParticipatingApplications(404n),
    ).resolves.toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('selects the whole target ledger and the current team name only', async () => {
    await repository.findParticipatingApplications(101n);

    const [args] = findMany.mock.calls[0] as [Prisma.ApplicationFindManyArgs];
    expect(args.select?.milestoneDocumentSubmissions).toEqual({
      select: submissionCompletionTargetSelect,
    });
    expect(args.select?.team).toEqual({ select: { name: true } });

    const programSelect = args.select?.program as {
      readonly select?: { readonly cover?: unknown };
    };
    expect(programSelect.select?.cover).toEqual({
      select: { id: true, imageUrl: true },
    });

    expect(args.select).not.toHaveProperty('applicant');
  });
});
