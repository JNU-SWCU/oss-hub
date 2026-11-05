import { RepositoryProvisionEventService } from '../github/repository-provision-event.service';
import { ProgramLifecycle, ProgramTrackType } from '@prisma/client';
import type {
  ApplicationsRepository,
  StaffDashboardSummary,
} from './team.repository';
import { TeamApplicationService } from './team-application.service';
import { RepositoryUrlService } from '../github/repository-url.service';
import { ApplicationAnswersService } from './team-application.service';

describe('TeamApplicationService.staffSummary', () => {
  it('repository 요약을 그대로 반환한다', async () => {
    const summary: StaffDashboardSummary = {
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
          lifecycle: ProgramLifecycle.PUBLISHED,
          applications: {
            total: 5,
            submitted: 2,
            approved: 2,
            rejected: 1,
          },
          teamManagementPath: '/programs/program-1/teams',
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

    await expect(service.staffSummary()).resolves.toEqual(summary);
    expect(listStaffDashboardSummary).toHaveBeenCalledTimes(1);
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

    await expect(service.staffSummary()).resolves.toEqual({
      programs: [],
    });
  });
});
