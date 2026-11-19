import { RepositoryProvisionEventService } from '../github/repository-provision-event.service';
import { Prisma, ProgramTrackType } from '@prisma/client';
import { PlatformRepository } from '../platform/platform.repository';
import type { PrismaService } from '../platform/prisma.service';
import { RepositoryProvisionGenerationRepository } from '../platform/repository-provision-generation.repository';
import {
  ApplicationsRepository,
  type StaffDashboardSummary,
} from './team.repository';
import { TeamHistoryRepository } from './team-history.repository';
import { TeamApplicationService } from './team-application.service';
import { RepositoryUrlService } from '../github/repository-url.service';
import { ApplicationAnswersService } from './team-application.service';

describe('TeamApplicationService.staffSummary', () => {
  it('repository 요약을 그대로 반환한다', async () => {
    const summary: StaffDashboardSummary = {
      page: 1,
      pageSize: 20,
      total: 1,
      catalogTotal: 1,
      statusSummary: { recruiting: 0, inProgress: 0, ended: 0 },
      programs: [
        {
          id: 'program-1',
          name: '기본 프로그램',
          trackType: ProgramTrackType.EXTRACURRICULAR,
          applicationPeriod: {
            startsAt: new Date('2026-07-01T00:00:00.000Z'),
            endsAt: new Date('2026-07-31T23:59:59.000Z'),
          },
          endAt: new Date('2026-09-30T23:59:59.000Z'),
          applications: {
            total: 5,
            pendingApproval: 2,
            approved: 2,
            rejected: 1,
          },
        },
      ],
    };
    const listStaffDashboardSummary = jest.fn().mockResolvedValue(summary);
    const repository = {
      listStaffDashboardSummary,
    } as unknown as ApplicationsRepository;
    const service = new TeamApplicationService(
      repository,
      new RepositoryUrlService(),
      new ApplicationAnswersService(),
      new RepositoryProvisionEventService(),
    );

    await expect(
      service.staffSummary({
        page: 1,
        pageSize: 20,
        search: '',
        status: 'all' as const,
        sort: 'submission',
        direction: 'desc',
        now: new Date('2026-07-15T00:00:00.000Z'),
      }),
    ).resolves.toEqual(summary);
    expect(listStaffDashboardSummary).toHaveBeenCalledWith({
      page: 1,
      pageSize: 20,
      search: '',
      status: 'all' as const,
      sort: 'submission',
      direction: 'desc',
      now: new Date('2026-07-15T00:00:00.000Z'),
    });
  });

  it('프로그램이 없으면 빈 programs 를 반환한다', async () => {
    const repository = {
      listStaffDashboardSummary: jest.fn().mockResolvedValue({ programs: [] }),
    } as unknown as ApplicationsRepository;
    const service = new TeamApplicationService(
      repository,
      new RepositoryUrlService(),
      new ApplicationAnswersService(),
      new RepositoryProvisionEventService(),
    );

    await expect(
      service.staffSummary({
        page: 1,
        pageSize: 20,
        search: '',
        status: 'all' as const,
        now: new Date('2026-07-15T00:00:00.000Z'),
      }),
    ).resolves.toEqual({
      programs: [],
    });
  });
});

describe('ApplicationsRepository.listStaffDashboardSummary', () => {
  const now = new Date('2026-07-15T00:00:00.000Z');
  const sortValues = [
    ['name', 'p."name"'],
    [
      'deadline',
      `CASE p.status WHEN 'recruiting' THEN p."applicationEndAt" WHEN 'in_progress' THEN milestone."dueAt" END`,
    ],
    [
      'submission',
      'milestone_counts."submittedTeams"::numeric / NULLIF(milestone_counts."totalTeams", 0)',
    ],
    [
      'pending',
      'COALESCE(pending_applications.total, 0) + COALESCE(pending_reviews.total, 0)',
    ],
  ] as const;

  it.each([
    {
      query: {},
      order: 'p."applicationStartAt" DESC, p."name" ASC, p."id" ASC',
    },
    ...sortValues.flatMap(([sort, value]) =>
      (['asc', 'desc'] as const).map((direction) => ({
        query: { sort, direction },
        order: `${value} ${direction.toUpperCase()} NULLS LAST, p."id" ASC`,
      })),
    ),
  ])(
    'applies $order before the database page window',
    async ({ query, order }) => {
      const ids = ['program-3', 'program-4'];
      const $queryRaw = jest
        .fn<Promise<unknown>, [TemplateStringsArray, ...unknown[]]>()
        .mockResolvedValueOnce([
          { total: 4, catalogTotal: 6, recruiting: 2, inProgress: 3, ended: 1 },
        ])
        .mockResolvedValueOnce(
          ids.map((id) => ({
            id,
            name: id,
            trackType: null,
            applicationStartAt: now,
            applicationEndAt: now,
            endAt: now,
          })),
        );
      const groupBy = jest.fn().mockResolvedValue([]);
      const repository = new ApplicationsRepository(
        { $queryRaw, team: { groupBy } } as unknown as PrismaService,
        new TeamHistoryRepository(),
        new RepositoryProvisionGenerationRepository(),
        new PlatformRepository(),
      );

      const summary = await repository.listStaffDashboardSummary({
        page: 9,
        pageSize: 2,
        search: 'filtered name',
        status: 'in_progress',
        now,
        ...query,
      });

      const pageQuery = $queryRaw.mock.calls[1];
      if (!pageQuery) throw new Error('Expected staff dashboard page query');
      const sql = Prisma.sql(...pageQuery);
      expect(sql.sql.replace(/\s+/g, ' ')).toContain(
        `ORDER BY ${order} LIMIT ? OFFSET ?`,
      );
      expect(sql.values.slice(-2)).toEqual([2, 2]);
      expect(summary.page).toBe(2);
      expect(summary.programs.map((program) => program.id)).toEqual(ids);
      expect($queryRaw).toHaveBeenCalledTimes(2);
      expect(groupBy).toHaveBeenCalledTimes(1);
      expect(groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { programId: { in: ids }, archivedAt: null },
        }),
      );
    },
  );
});
