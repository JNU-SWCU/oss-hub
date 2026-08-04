import { ProgramCategory } from '@prisma/client';
import type {
  ApplicationsRepository,
  StaffDashboardSummary,
} from './applications.repository';
import { ApplicationsService } from './applications.service';
import type { AuditLogService } from '../audit-log/audit-log.service';

/** 이 스펙들은 판정 경로를 타지 않으므로 감사 기록기는 호출되지 않는다. */
const noopAuditLog = { record: jest.fn() } as unknown as AuditLogService;

describe('ApplicationsService.staffSummary', () => {
  it('repository 요약을 그대로 반환한다', async () => {
    const summary: StaffDashboardSummary = {
      programs: [
        {
          id: 'program-1',
          name: '기본 프로그램',
          category: ProgramCategory.BASIC,
          applicationPeriod: {
            startsAt: new Date('2026-07-01T00:00:00.000Z'),
            endsAt: new Date('2026-07-31T23:59:59.000Z'),
          },
          applications: {
            total: 5,
            submitted: 2,
            approved: 2,
            rejected: 1,
          },
          applicantsPath: '/programs/program-1/applicants',
        },
      ],
    };
    const listStaffDashboardSummary = jest.fn().mockResolvedValue(summary);
    const repository = {
      listStaffDashboardSummary,
    } as unknown as ApplicationsRepository;
    const service = new ApplicationsService(repository, noopAuditLog);

    await expect(service.staffSummary()).resolves.toEqual(summary);
    expect(listStaffDashboardSummary).toHaveBeenCalledTimes(1);
  });

  it('프로그램이 없으면 빈 programs 를 반환한다', async () => {
    const repository = {
      listStaffDashboardSummary: jest.fn().mockResolvedValue({ programs: [] }),
    } as unknown as ApplicationsRepository;
    const service = new ApplicationsService(repository, noopAuditLog);

    await expect(service.staffSummary()).resolves.toEqual({ programs: [] });
  });
});
