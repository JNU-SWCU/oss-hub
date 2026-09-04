import type { ProgramViewer } from './program-viewer.service';
import {
  ApplicationStatus,
  Prisma,
  ProgramLifecycle,
  ProgramTrackType,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PROGRAM_LIST_QUERY_STATUSES } from '../program-list-query';
import {
  deriveProgramListStatus,
  programListPrismaWhere,
  programListSortRank,
  programListSqlStatusPredicate,
  type ProgramListDerivedStatus,
  type ProgramListStatusInput,
} from '../program-list-status-filter';
import { ProgramsRepository } from '../repository/programs.repository';
import type { ProgramListRecord } from '../repository/programs.repository';
import { ProgramsService } from './programs.service';

const NOW = new Date('2026-07-22T00:00:00.000Z');

function baseProgram(
  partial: Partial<ProgramListStatusInput> = {},
): ProgramListStatusInput {
  return {
    lifecycle: ProgramLifecycle.PUBLISHED,
    applicationStartAt: new Date('2026-06-01T00:00:00.000Z'),
    applicationEndAt: new Date('2026-08-01T00:00:00.000Z'),
    endAt: new Date('2026-12-01T00:00:00.000Z'),
    ...partial,
  };
}

describe('deriveProgramListStatus (period interpretation)', () => {
  it('returns exactly one status for representative date combinations (U1)', () => {
    const cases: readonly {
      readonly label: string;
      readonly program: ProgramListStatusInput;
      readonly expected: ProgramListDerivedStatus;
    }[] = [
      {
        label: 'before application window',
        program: baseProgram({
          applicationStartAt: new Date('2026-08-01T00:00:00.000Z'),
          applicationEndAt: new Date('2026-09-01T00:00:00.000Z'),
          endAt: new Date('2026-12-01T00:00:00.000Z'),
        }),
        expected: 'upcoming',
      },
      {
        label: 'inside application window',
        program: baseProgram({
          applicationStartAt: new Date('2026-06-01T00:00:00.000Z'),
          applicationEndAt: new Date('2026-08-01T00:00:00.000Z'),
          endAt: new Date('2026-12-01T00:00:00.000Z'),
        }),
        expected: 'recruiting',
      },
      {
        label: 'after apply end, before endAt',
        program: baseProgram({
          applicationStartAt: new Date('2026-01-01T00:00:00.000Z'),
          applicationEndAt: new Date('2026-02-01T00:00:00.000Z'),
          endAt: new Date('2026-12-01T00:00:00.000Z'),
        }),
        expected: 'in_progress',
      },
      {
        label: 'after endAt',
        program: baseProgram({
          applicationStartAt: new Date('2026-01-01T00:00:00.000Z'),
          applicationEndAt: new Date('2026-02-01T00:00:00.000Z'),
          endAt: new Date('2026-07-01T00:00:00.000Z'),
        }),
        expected: 'ended',
      },
    ];

    for (const { program, expected } of cases) {
      expect(deriveProgramListStatus(program, NOW)).toBe(expected);
    }
  });

  it('resolves boundaries with a single status (U2)', () => {
    expect(
      deriveProgramListStatus(
        baseProgram({
          applicationStartAt: NOW,
          applicationEndAt: new Date('2026-08-01T00:00:00.000Z'),
          endAt: new Date('2026-12-01T00:00:00.000Z'),
        }),
        NOW,
      ),
    ).toBe('recruiting');

    expect(
      deriveProgramListStatus(
        baseProgram({
          applicationStartAt: new Date('2026-06-01T00:00:00.000Z'),
          applicationEndAt: NOW,
          endAt: new Date('2026-12-01T00:00:00.000Z'),
        }),
        NOW,
      ),
    ).toBe('recruiting');

    // endAt === now 는 ended 가 아니다 (endAt < now 만 ended).
    expect(
      deriveProgramListStatus(
        baseProgram({
          applicationStartAt: new Date('2026-01-01T00:00:00.000Z'),
          applicationEndAt: new Date('2026-02-01T00:00:00.000Z'),
          endAt: NOW,
        }),
        NOW,
      ),
    ).toBe('in_progress');
  });

  it('remains in progress before its required endAt (U3)', () => {
    expect(
      deriveProgramListStatus(
        baseProgram({
          applicationStartAt: new Date('2026-01-01T00:00:00.000Z'),
          applicationEndAt: new Date('2026-02-01T00:00:00.000Z'),
          endAt: new Date('2026-12-01T00:00:00.000Z'),
        }),
        NOW,
      ),
    ).toBe('in_progress');
  });

  it('prefers ended when apply window is still open but endAt passed (U4)', () => {
    // seed:repositories:program 회귀 — 접수창 열림 ∩ endAt 과거
    const program = baseProgram({
      applicationStartAt: new Date('2026-06-25T00:00:00.000Z'),
      applicationEndAt: new Date('2026-06-30T00:00:00.000Z'),
      endAt: new Date('2026-07-01T00:00:00.000Z'),
    });
    expect(deriveProgramListStatus(program, NOW)).toBe('ended');
  });

  it('maps ARCHIVED to ended and sort rank stays ended (U5/U6)', () => {
    const archived = baseProgram({
      lifecycle: ProgramLifecycle.ARCHIVED,
      applicationStartAt: new Date('2026-06-01T00:00:00.000Z'),
      applicationEndAt: new Date('2026-09-01T00:00:00.000Z'),
      endAt: new Date('2026-12-01T00:00:00.000Z'),
    });
    expect(deriveProgramListStatus(archived, NOW)).toBe('ended');
    expect(programListSortRank('ended')).toBe(3);
    expect(programListSortRank('recruiting')).toBe(0);
  });
});

describe('ProgramsRepository list', () => {
  const count = jest.fn();
  const transaction = jest.fn();
  const queryRaw = jest.fn<
    Promise<readonly ProgramListRecord[]>,
    [Prisma.Sql]
  >();
  const prisma = {
    $transaction: transaction,
    $queryRaw: queryRaw,
    program: { count },
  } as unknown as PrismaService;
  const repository = new ProgramsRepository(prisma);

  beforeEach(() => {
    count.mockReset();
    transaction.mockReset();
    queryRaw.mockReset();
  });

  it('applies search and recruiting filters before the page boundary', async () => {
    queryRaw.mockResolvedValue([]);
    count.mockResolvedValue(0);
    transaction.mockResolvedValue([[], 0]);
    const now = new Date('2026-07-22T00:00:00.000Z');

    await repository.listPrograms(
      { page: 2, pageSize: 10, search: 'contest', status: 'recruiting' },
      now,
    );

    const where = {
      lifecycle: ProgramLifecycle.PUBLISHED,
      applicationStartAt: { lte: now },
      applicationEndAt: { gte: now },
      endAt: { gte: now },
      name: { contains: 'contest', mode: 'insensitive' },
    };
    const rawQuery = queryRaw.mock.calls[0]?.[0];
    expect(rawQuery?.strings.join(' ')).toContain('p."applicationEndAt"');
    expect(rawQuery?.values).toContain(now);
    expect(rawQuery?.values).toContain('%contest%');
    expect(rawQuery?.values).toContain(10);
    expect(count).toHaveBeenCalledWith({ where });
  });

  it('orders deadline priority in the database before pagination', async () => {
    queryRaw.mockResolvedValue([]);
    count.mockResolvedValue(21);
    transaction.mockResolvedValue([[], 21]);

    await repository.listPrograms(
      { page: 1, pageSize: 20, search: '', status: 'all' },
      new Date('2026-08-01T00:00:00.000Z'),
    );

    const rawQuery = queryRaw.mock.calls[0]?.[0];
    const sql = rawQuery?.strings.join(' ') ?? '';
    expect(sql).toContain('ORDER BY');
    expect(sql).toContain('p."applicationEndAt" ASC');
    expect(sql).toMatch(/recruiting|WHEN/);
    expect(rawQuery?.values).toContain(20);
    expect(rawQuery?.values).toContain(0);
  });

  it('uses the same in_progress filter for count and page rows', async () => {
    queryRaw.mockResolvedValue([]);
    count.mockResolvedValue(21);
    transaction.mockResolvedValue([[], 21]);
    const now = new Date('2026-07-22T00:00:00.000Z');

    await repository.listPrograms(
      { page: 1, pageSize: 20, search: '', status: 'in_progress' },
      now,
    );

    const rawQuery = queryRaw.mock.calls[0]?.[0];
    expect(rawQuery?.values).toContain(now);
    expect(count).toHaveBeenCalledWith({
      where: {
        lifecycle: ProgramLifecycle.PUBLISHED,
        applicationStartAt: { lte: now },
        applicationEndAt: { lt: now },
        endAt: { gte: now },
      },
    });
  });

  it('uses the same upcoming filter for count and page rows', async () => {
    queryRaw.mockResolvedValue([]);
    count.mockResolvedValue(3);
    transaction.mockResolvedValue([[], 3]);
    const now = new Date('2026-07-22T00:00:00.000Z');

    await repository.listPrograms(
      { page: 1, pageSize: 20, search: '', status: 'upcoming' },
      now,
    );

    expect(count).toHaveBeenCalledWith({
      where: {
        lifecycle: ProgramLifecycle.PUBLISHED,
        applicationStartAt: { gt: now },
        endAt: { gte: now },
      },
    });
  });

  it('uses the same ended filter for count and page rows', async () => {
    queryRaw.mockResolvedValue([]);
    count.mockResolvedValue(9);
    transaction.mockResolvedValue([[], 9]);
    const now = new Date('2026-07-22T00:00:00.000Z');

    await repository.listPrograms(
      { page: 1, pageSize: 20, search: '', status: 'ended' },
      now,
    );

    expect(count).toHaveBeenCalledWith({
      where: {
        OR: [
          { lifecycle: ProgramLifecycle.ARCHIVED },
          {
            lifecycle: ProgramLifecycle.PUBLISHED,
            endAt: { lt: now },
          },
        ],
      },
    });
  });

  it('counts all across PUBLISHED and ARCHIVED universe', async () => {
    queryRaw.mockResolvedValue([]);
    count.mockResolvedValue(0);
    transaction.mockResolvedValue([[], 0]);
    const now = new Date('2026-07-22T00:00:00.000Z');

    await repository.listPrograms(
      { page: 1, pageSize: 20, search: '', status: 'all' },
      now,
    );

    expect(count).toHaveBeenCalledWith({
      where: {
        lifecycle: {
          in: [ProgramLifecycle.PUBLISHED, ProgramLifecycle.ARCHIVED],
        },
      },
    });
  });
});

describe('ProgramsRepository viewer personalization batch queries', () => {
  const findMany = jest.fn();
  const groupBy = jest.fn();
  const prisma = {
    application: { findMany, groupBy },
  } as unknown as PrismaService;
  const repository = new ProgramsRepository(prisma);

  beforeEach(() => {
    findMany.mockReset();
    groupBy.mockReset();
  });

  it('findViewerApplicationStatuses 는 programId in (...) 한 번으로 배치 조회한다', async () => {
    findMany.mockResolvedValue([
      { programId: 'program-a', status: 'SUBMITTED' },
      { programId: 'program-b', status: 'APPROVED' },
    ]);

    const statuses = await repository.findViewerApplicationStatuses(
      ['program-a', 'program-b', 'program-c'],
      'student-1',
    );

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith({
      where: {
        programId: { in: ['program-a', 'program-b', 'program-c'] },
        OR: [
          { applicantId: 'student-1' },
          { team: { leaderId: 'student-1' } },
          { team: { members: { some: { userId: 'student-1' } } } },
        ],
      },
      select: { programId: true, status: true },
    });
    expect(statuses.get('program-a')).toBe('SUBMITTED');
    expect(statuses.get('program-b')).toBe('APPROVED');
    expect(statuses.has('program-c')).toBe(false);
  });

  it('findViewerApplicationStatuses 는 빈 programId 목록에 쿼리를 보내지 않는다', async () => {
    const statuses = await repository.findViewerApplicationStatuses(
      [],
      'student-1',
    );

    expect(findMany).not.toHaveBeenCalled();
    expect(statuses.size).toBe(0);
  });

  it('countApplicationsByProgram 은 groupBy 한 번으로 total/pending 을 배치 집계한다', async () => {
    groupBy.mockResolvedValue([
      { programId: 'program-a', status: 'SUBMITTED', _count: { _all: 2 } },
      { programId: 'program-a', status: 'APPROVED', _count: { _all: 1 } },
      { programId: 'program-b', status: 'REJECTED', _count: { _all: 4 } },
    ]);

    const counts = await repository.countApplicationsByProgram([
      'program-a',
      'program-b',
      'program-c',
    ]);

    expect(groupBy).toHaveBeenCalledTimes(1);
    expect(groupBy).toHaveBeenCalledWith({
      by: ['programId', 'status'],
      where: { programId: { in: ['program-a', 'program-b', 'program-c'] } },
      _count: { _all: true },
    });
    expect(counts.get('program-a')).toEqual({ total: 3, pending: 2 });
    expect(counts.get('program-b')).toEqual({ total: 4, pending: 0 });
    expect(counts.has('program-c')).toBe(false);
  });

  it('countApplicationsByProgram 은 빈 programId 목록에 쿼리를 보내지 않는다', async () => {
    const counts = await repository.countApplicationsByProgram([]);

    expect(groupBy).not.toHaveBeenCalled();
    expect(counts.size).toBe(0);
  });
});

type ProgramStatusCountsRow = {
  readonly all: number;
  readonly recruiting: number;
  readonly in_progress: number;
  readonly upcoming: number;
  readonly ended: number;
};

describe('ProgramsRepository countProgramsByStatus', () => {
  const queryRaw = jest.fn<
    Promise<readonly ProgramStatusCountsRow[]>,
    [Prisma.Sql]
  >();
  const prisma = {
    $queryRaw: queryRaw,
  } as unknown as PrismaService;
  const repository = new ProgramsRepository(prisma);

  beforeEach(() => {
    queryRaw.mockReset();
  });

  it('returns all five status keys including zeros', async () => {
    queryRaw.mockResolvedValue([
      {
        all: 15,
        recruiting: 3,
        in_progress: 3,
        upcoming: 0,
        ended: 9,
      },
    ]);
    const now = new Date('2026-07-22T00:00:00.000Z');

    await expect(repository.countProgramsByStatus(now)).resolves.toEqual({
      all: 15,
      recruiting: 3,
      in_progress: 3,
      upcoming: 0,
      ended: 9,
    });

    const rawQuery = queryRaw.mock.calls[0]?.[0];
    const sql = rawQuery?.strings.join(' ') ?? '';
    expect(sql).toContain('COUNT(*) FILTER');
    expect(sql).toContain('FROM "Program"');
    expect(sql).toContain('lifecycle');
    expect(rawQuery?.values).toContain(now);
  });

  it('defaults missing row to zeros', async () => {
    queryRaw.mockResolvedValue([]);
    await expect(
      repository.countProgramsByStatus(new Date('2026-07-22T00:00:00.000Z')),
    ).resolves.toEqual({
      all: 0,
      recruiting: 0,
      in_progress: 0,
      upcoming: 0,
      ended: 0,
    });
  });
});

describe('status filter single source', () => {
  it('exposes the same predicate keys as list query statuses', () => {
    const now = new Date('2026-07-22T00:00:00.000Z');
    for (const status of PROGRAM_LIST_QUERY_STATUSES) {
      expect(programListPrismaWhere(status, now)).toBeDefined();
      const sql = programListSqlStatusPredicate(status, now);
      expect(sql.strings.join(' ')).toMatch(
        /lifecycle|ARCHIVED|PUBLISHED|ended|recruiting|upcoming|in_progress/i,
      );
    }
  });
});

const anonymousViewer = { githubId: null, userId: null, role: null } as const;

function listRecord(
  overrides: Partial<ProgramListRecord> = {},
): ProgramListRecord {
  return {
    id: 'program-1',
    name: '프로그램',
    organizer: '운영기관',
    trackType: ProgramTrackType.CURRICULAR,
    applicationTemplateKey: 'capstone',
    lifecycle: ProgramLifecycle.PUBLISHED,
    applicationStartAt: new Date('2026-07-01T00:00:00.000Z'),
    applicationEndAt: new Date('2026-08-01T00:00:00.000Z'),
    endAt: new Date('2026-12-31T00:00:00.000Z'),
    description: '설명',
    teamMinSize: 1,
    teamMaxSize: 1,
    ...overrides,
  };
}

describe('ProgramsService list', () => {
  it('returns page metadata from the repository count', async () => {
    const repository = {
      listPrograms: jest.fn().mockResolvedValue([[], 21]),
    };
    const service = new ProgramsService(
      repository as unknown as ProgramsRepository,
    );

    await expect(
      service.list(
        { page: 1, pageSize: 20, search: '', status: 'all' },
        anonymousViewer,
      ),
    ).resolves.toEqual({
      items: [],
      page: 1,
      pageSize: 20,
      totalItems: 21,
      totalPages: 2,
    });
  });

  it('비인증 요청에는 개인화 필드를 절대 담지 않는다', async () => {
    const items = [listRecord()];
    const findViewerApplicationStatuses = jest.fn();
    const countApplicationsByProgram = jest.fn();
    const repository = {
      listPrograms: jest.fn().mockResolvedValue([items, 1]),
      findViewerApplicationStatuses,
      countApplicationsByProgram,
    };
    const service = new ProgramsService(
      repository as unknown as ProgramsRepository,
    );

    const page = await service.list(
      { page: 1, pageSize: 20, search: '', status: 'all' },
      anonymousViewer,
    );

    expect(page.items).toEqual(items);
    expect(findViewerApplicationStatuses).not.toHaveBeenCalled();
    expect(countApplicationsByProgram).not.toHaveBeenCalled();
  });

  it('학생 뷰어는 본인 신청 상태와 안내 문구를 배치 조회 한 번으로 붙인다', async () => {
    const items = [
      listRecord({ id: 'program-applied' }),
      listRecord({ id: 'program-not-applied' }),
    ];
    const findViewerApplicationStatuses = jest
      .fn()
      .mockResolvedValue(
        new Map([['program-applied', ApplicationStatus.SUBMITTED]]),
      );
    const repository = {
      listPrograms: jest.fn().mockResolvedValue([items, 2]),
      findViewerApplicationStatuses,
    };
    const service = new ProgramsService(
      repository as unknown as ProgramsRepository,
    );
    const viewer = {
      githubId: 1n,
      userId: 'student-1',
      role: 'STUDENT',
    } satisfies ProgramViewer;

    const page = await service.list(
      { page: 1, pageSize: 20, search: '', status: 'all' },
      viewer,
    );

    expect(findViewerApplicationStatuses).toHaveBeenCalledTimes(1);
    expect(findViewerApplicationStatuses).toHaveBeenCalledWith(
      ['program-applied', 'program-not-applied'],
      'student-1',
    );
    expect(page.items[0]).toMatchObject({
      viewerApplicationStatus: ApplicationStatus.SUBMITTED,
      note: { text: '지원서 제출됨 · 교직원 승인을 기다립니다' },
    });
    expect(page.items[1]).toEqual(items[1]);
    expect((page.items[1] as { note?: unknown }).note).toBeUndefined();
    expect(
      (page.items[1] as { viewerApplicationStatus?: unknown })
        .viewerApplicationStatus,
    ).toBeUndefined();
  });

  it('팀 단위 프로그램의 학생 note 에는 팀 아이콘이 붙는다', async () => {
    const items = [
      listRecord({ id: 'team-program', teamMinSize: 2, teamMaxSize: 4 }),
    ];
    const repository = {
      listPrograms: jest.fn().mockResolvedValue([items, 1]),
      findViewerApplicationStatuses: jest
        .fn()
        .mockResolvedValue(
          new Map([['team-program', ApplicationStatus.APPROVED]]),
        ),
    };
    const service = new ProgramsService(
      repository as unknown as ProgramsRepository,
    );
    const viewer = {
      githubId: 1n,
      userId: 'student-1',
      role: 'STUDENT',
    } satisfies ProgramViewer;

    const page = await service.list(
      { page: 1, pageSize: 20, search: '', status: 'all' },
      viewer,
    );

    expect(page.items[0]).toMatchObject({
      note: { text: '축하합니다, 참가가 확정되었습니다', icon: 'team' },
    });
  });

  it('BASIC 1인 팀 참여도 팀 아이콘을 붙인다', async () => {
    const items = [
      listRecord({
        id: 'individual-program',
        trackType: ProgramTrackType.EXTRACURRICULAR,
        applicationTemplateKey: 'basic',
        teamMinSize: 1,
        teamMaxSize: 1,
      }),
    ];
    const repository = {
      listPrograms: jest.fn().mockResolvedValue([items, 1]),
      findViewerApplicationStatuses: jest
        .fn()
        .mockResolvedValue(
          new Map([['individual-program', ApplicationStatus.APPROVED]]),
        ),
    };
    const service = new ProgramsService(
      repository as unknown as ProgramsRepository,
    );

    const page = await service.list(
      { page: 1, pageSize: 20, search: '', status: 'all' },
      {
        githubId: 1n,
        userId: 'student-1',
        role: 'STUDENT',
      } satisfies ProgramViewer,
    );

    expect(page.items[0]?.note).toEqual({
      text: '축하합니다, 참가가 확정되었습니다',
      icon: 'team',
    });
  });

  it('교직원 뷰어는 전체 지원/승인 대기 집계를 배치 조회 한 번으로 붙인다', async () => {
    const items = [
      listRecord({ id: 'program-with-pending' }),
      listRecord({ id: 'program-none' }),
    ];
    const countApplicationsByProgram = jest
      .fn()
      .mockResolvedValue(
        new Map([['program-with-pending', { total: 3, pending: 1 }]]),
      );
    const repository = {
      listPrograms: jest.fn().mockResolvedValue([items, 2]),
      countApplicationsByProgram,
    };
    const service = new ProgramsService(
      repository as unknown as ProgramsRepository,
    );
    const viewer = {
      githubId: 2n,
      userId: 'staff-1',
      role: 'STAFF',
    } satisfies ProgramViewer;

    const page = await service.list(
      { page: 1, pageSize: 20, search: '', status: 'all' },
      viewer,
    );

    expect(countApplicationsByProgram).toHaveBeenCalledTimes(1);
    expect(countApplicationsByProgram).toHaveBeenCalledWith([
      'program-with-pending',
      'program-none',
    ]);
    expect(page.items[0]).toMatchObject({
      applicationCount: 3,
      pendingApplicationCount: 1,
      note: { text: '지원 3건 · 승인 대기 1건' },
    });
    expect(page.items[1]).toMatchObject({
      applicationCount: 0,
      pendingApplicationCount: 0,
      note: { text: '지원 0건' },
    });
  });

  it('ADMIN 뷰어도 교직원과 동일하게 지원 집계를 받는다', async () => {
    const items = [listRecord({ id: 'program-1' })];
    const countApplicationsByProgram = jest
      .fn()
      .mockResolvedValue(new Map([['program-1', { total: 5, pending: 0 }]]));
    const repository = {
      listPrograms: jest.fn().mockResolvedValue([items, 1]),
      countApplicationsByProgram,
    };
    const service = new ProgramsService(
      repository as unknown as ProgramsRepository,
    );
    const viewer = {
      githubId: 3n,
      userId: 'admin-1',
      role: 'ADMIN',
    } satisfies ProgramViewer;

    const page = await service.list(
      { page: 1, pageSize: 20, search: '', status: 'all' },
      viewer,
    );

    expect(page.items[0]).toMatchObject({
      applicationCount: 5,
      pendingApplicationCount: 0,
      note: { text: '지원 5건' },
    });
  });

  it('PENDING 역할은 어느 개인화 조회도 트리거하지 않는다', async () => {
    const items = [listRecord()];
    const findViewerApplicationStatuses = jest.fn();
    const countApplicationsByProgram = jest.fn();
    const repository = {
      listPrograms: jest.fn().mockResolvedValue([items, 1]),
      findViewerApplicationStatuses,
      countApplicationsByProgram,
    };
    const service = new ProgramsService(
      repository as unknown as ProgramsRepository,
    );
    const viewer = {
      githubId: 4n,
      userId: 'pending-1',
      role: 'PENDING' as const,
    };

    const page = await service.list(
      { page: 1, pageSize: 20, search: '', status: 'all' },
      viewer,
    );

    expect(page.items).toEqual(items);
    expect(findViewerApplicationStatuses).not.toHaveBeenCalled();
    expect(countApplicationsByProgram).not.toHaveBeenCalled();
  });

  it('returns status counts from the repository', async () => {
    const counts = {
      all: 10,
      recruiting: 2,
      in_progress: 4,
      upcoming: 1,
      ended: 3,
    };
    const repository = {
      countProgramsByStatus: jest.fn().mockResolvedValue(counts),
    };
    const service = new ProgramsService(
      repository as unknown as ProgramsRepository,
    );

    await expect(service.statusCounts()).resolves.toEqual(counts);
    expect(repository.countProgramsByStatus).toHaveBeenCalled();
  });
});

/**
 * Prisma where 는 배타 기간 술어로 전개된다.
 * 모양 고정이 아니라 회귀 픽스처가 한 상태에만 속하는지 derive 와 맞춰 본다.
 */
describe('status-counts consistency with list totalItems filters', () => {
  it('keeps all in the published+archived universe and ends U4 only once', () => {
    const now = new Date('2026-07-22T00:00:00.000Z');
    expect(programListPrismaWhere('all', now)).toEqual({
      lifecycle: {
        in: [ProgramLifecycle.PUBLISHED, ProgramLifecycle.ARCHIVED],
      },
    });
    expect(programListPrismaWhere('recruiting', now)).toEqual({
      lifecycle: ProgramLifecycle.PUBLISHED,
      applicationStartAt: { lte: now },
      applicationEndAt: { gte: now },
      endAt: { gte: now },
    });
    expect(programListPrismaWhere('ended', now)).toEqual({
      OR: [
        { lifecycle: ProgramLifecycle.ARCHIVED },
        {
          lifecycle: ProgramLifecycle.PUBLISHED,
          endAt: { lt: now },
        },
      ],
    });

    const u4 = baseProgram({
      applicationStartAt: new Date('2026-06-25T00:00:00.000Z'),
      applicationEndAt: new Date('2026-09-13T00:00:00.000Z'),
      endAt: new Date('2026-07-01T00:00:00.000Z'),
    });
    expect(deriveProgramListStatus(u4, now)).toBe('ended');
  });
});
