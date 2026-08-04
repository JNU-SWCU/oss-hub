import { Prisma, ProgramLifecycle } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PROGRAM_LIST_QUERY_STATUSES } from './program-list-query';
import {
  deriveProgramListStatus,
  programListPrismaWhere,
  programListSortRank,
  programListSqlStatusPredicate,
  type ProgramListDerivedStatus,
  type ProgramListStatusInput,
} from './program-list-status-filter';
import { ProgramsRepository } from './programs.repository';
import type { ProgramListRecord } from './programs.repository';
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
          endAt: null,
        }),
        expected: 'upcoming',
      },
      {
        label: 'inside application window',
        program: baseProgram({
          applicationStartAt: new Date('2026-06-01T00:00:00.000Z'),
          applicationEndAt: new Date('2026-08-01T00:00:00.000Z'),
          endAt: null,
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
          endAt: null,
        }),
        NOW,
      ),
    ).toBe('recruiting');

    expect(
      deriveProgramListStatus(
        baseProgram({
          applicationStartAt: new Date('2026-06-01T00:00:00.000Z'),
          applicationEndAt: NOW,
          endAt: null,
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

  it('never ends when endAt is null (U3)', () => {
    expect(
      deriveProgramListStatus(
        baseProgram({
          applicationStartAt: new Date('2026-01-01T00:00:00.000Z'),
          applicationEndAt: new Date('2026-02-01T00:00:00.000Z'),
          endAt: null,
        }),
        NOW,
      ),
    ).toBe('in_progress');
  });

  it('prefers ended when apply window is still open but endAt passed (U4)', () => {
    // seed:repositories:program 회귀 — 접수창 열림 ∩ endAt 과거
    const program = baseProgram({
      applicationStartAt: new Date('2026-06-25T00:00:00.000Z'),
      applicationEndAt: new Date('2026-09-13T00:00:00.000Z'),
      endAt: new Date('2026-07-01T00:00:00.000Z'),
    });
    expect(deriveProgramListStatus(program, NOW)).toBe('ended');
  });

  it('maps ARCHIVED to ended and sort rank stays ended (U5/U6)', () => {
    const archived = baseProgram({
      lifecycle: ProgramLifecycle.ARCHIVED,
      applicationStartAt: new Date('2026-06-01T00:00:00.000Z'),
      applicationEndAt: new Date('2026-09-01T00:00:00.000Z'),
      endAt: null,
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
      OR: [{ endAt: null }, { endAt: { gte: now } }],
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
        OR: [{ endAt: null }, { endAt: { gte: now } }],
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
        OR: [{ endAt: null }, { endAt: { gte: now } }],
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
            endAt: { not: null, lt: now },
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

describe('ProgramsService list', () => {
  const program = {
    id: 'program-1',
    name: 'OSS 경진대회',
    organizer: 'SW Center',
    category: 'OSS_CONTEST',
    lifecycle: ProgramLifecycle.PUBLISHED,
    applicationStartAt: new Date('2026-07-01T00:00:00.000Z'),
    applicationEndAt: new Date('2026-08-31T00:00:00.000Z'),
    endAt: new Date('2026-12-31T00:00:00.000Z'),
    description: '프로그램 설명',
  } as const;

  it('returns page metadata from the repository count', async () => {
    const repository = {
      listPrograms: jest.fn().mockResolvedValue([[], 21]),
      findStudentApplicationStatuses: jest.fn(),
    };
    const service = new ProgramsService(
      repository as unknown as ProgramsRepository,
    );

    await expect(
      service.list({ page: 1, pageSize: 20, search: '', status: 'all' }),
    ).resolves.toEqual({
      items: [],
      page: 1,
      pageSize: 20,
      totalItems: 21,
      totalPages: 2,
    });
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

  it('익명 목록은 신청 상태를 조회하지 않고 null을 반환한다', async () => {
    const findStudentApplicationStatuses = jest.fn();
    const repository = {
      listPrograms: jest.fn().mockResolvedValue([[program], 1]),
      findStudentApplicationStatuses,
    };
    const service = new ProgramsService(
      repository as unknown as ProgramsRepository,
    );

    const result = await service.list({
      page: 1,
      pageSize: 20,
      search: '',
      status: 'all',
    });

    expect(result.items[0]?.applicationStatus).toBeNull();
    expect(findStudentApplicationStatuses).not.toHaveBeenCalled();
  });

  it('학생 목록은 본인이 신청한 프로그램에 신청 상태를 결합한다', async () => {
    const findStudentApplicationStatuses = jest
      .fn()
      .mockResolvedValue([{ programId: 'program-1', status: 'SUBMITTED' }]);
    const repository = {
      listPrograms: jest.fn().mockResolvedValue([[program], 1]),
      findStudentApplicationStatuses,
    };
    const service = new ProgramsService(
      repository as unknown as ProgramsRepository,
    );

    const result = await service.list(
      { page: 1, pageSize: 20, search: '', status: 'all' },
      { githubId: 101n, userId: 'student-1', role: 'STUDENT' },
    );

    expect(result.items[0]?.applicationStatus).toBe('SUBMITTED');
    expect(findStudentApplicationStatuses).toHaveBeenCalledWith(
      ['program-1'],
      'student-1',
    );
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
      OR: [{ endAt: null }, { endAt: { gte: now } }],
    });
    expect(programListPrismaWhere('ended', now)).toEqual({
      OR: [
        { lifecycle: ProgramLifecycle.ARCHIVED },
        {
          lifecycle: ProgramLifecycle.PUBLISHED,
          endAt: { not: null, lt: now },
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
