import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ProgramCategory } from '@prisma/client';
import { SessionGuard } from '../auth/session.guard';
import { ApplicationsStaffListGuard } from './applications-staff.guard';
import type { ApplicationsService } from './applications.service';
import { StaffDashboardController } from './staff-dashboard.controller';

function readGuards(target: object, methodName: 'summary'): unknown[] {
  const method: unknown = Object.getOwnPropertyDescriptor(
    target,
    methodName,
  )?.value;
  if (typeof method !== 'function') return [];
  const guards: unknown = Reflect.getMetadata(GUARDS_METADATA, method);
  return Array.isArray(guards) ? guards : [];
}

describe('StaffDashboardController', () => {
  it('GET summary 에 SessionGuard·ApplicationsStaffListGuard 를 적용한다', () => {
    expect(
      readGuards(StaffDashboardController.prototype, 'summary'),
    ).toEqual([SessionGuard, ApplicationsStaffListGuard]);
  });

  it('service.staffSummary 결과를 DTO 로 반환한다', async () => {
    const staffSummary = jest.fn().mockResolvedValue({
      programs: [
        {
          id: 'program:1',
          name: '합성 프로그램',
          category: ProgramCategory.BASIC,
          applicationPeriod: {
            startsAt: new Date('2026-07-01T00:00:00.000Z'),
            endsAt: new Date('2026-07-31T23:59:59.000Z'),
          },
          applications: {
            total: 3,
            submitted: 1,
            approved: 1,
            rejected: 1,
          },
          applicantsPath: '/staff/programs/program%3A1/applicants',
        },
      ],
    });
    const service: Pick<ApplicationsService, 'staffSummary'> = { staffSummary };
    const controller = new StaffDashboardController(service);

    await expect(controller.summary()).resolves.toEqual({
      programs: [
        {
          id: 'program:1',
          name: '합성 프로그램',
          category: ProgramCategory.BASIC,
          applicationPeriod: {
            startsAt: '2026-07-01T00:00:00.000Z',
            endsAt: '2026-07-31T23:59:59.000Z',
          },
          applications: {
            total: 3,
            submitted: 1,
            approved: 1,
            rejected: 1,
          },
          applicantsPath: '/staff/programs/program%3A1/applicants',
        },
      ],
    });
    expect(staffSummary).toHaveBeenCalledTimes(1);
  });
});
