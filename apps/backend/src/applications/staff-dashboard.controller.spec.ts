import {
  GUARDS_METADATA,
  HEADERS_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { ProgramCategory } from '@prisma/client';
import { SessionGuard } from '../auth/session.guard';
import { ApplicationsStaffListGuard } from './applications-staff.guard';
import { StaffDashboardController } from './staff-dashboard.controller';
import type { StaffDashboardService } from './staff-dashboard.service';

function readGuards(
  target: object,
  methodName: 'summary' | 'insightsSummary',
): unknown[] {
  const method: unknown = Object.getOwnPropertyDescriptor(
    target,
    methodName,
  )?.value;
  if (typeof method !== 'function') return [];
  const guards: unknown = Reflect.getMetadata(GUARDS_METADATA, method);
  return Array.isArray(guards) ? guards : [];
}

describe('StaffDashboardController', () => {
  it('applies route metadata, no-store cache, and staff list guards', () => {
    // Given
    const summary: unknown = Object.getOwnPropertyDescriptor(
      StaffDashboardController.prototype,
      'summary',
    )?.value;
    if (typeof summary !== 'function') {
      throw new TypeError('StaffDashboardController.summary is missing');
    }

    // When / Then
    expect(Reflect.getMetadata(PATH_METADATA, StaffDashboardController)).toBe(
      'dashboard/staff',
    );
    expect(Reflect.getMetadata(PATH_METADATA, summary)).toBe('summary');
    expect(Reflect.getMetadata(HEADERS_METADATA, summary)).toContainEqual({
      name: 'Cache-Control',
      value: 'private, no-store',
    });
    expect(readGuards(StaffDashboardController.prototype, 'summary')).toEqual([
      SessionGuard,
      ApplicationsStaffListGuard,
    ]);
  });

  it('maps composed service summary into the response DTO', async () => {
    // Given
    const summary = jest.fn().mockResolvedValue({
      programs: [
        {
          id: 'program:1',
          name: 'Synthetic program',
          category: ProgramCategory.BASIC,
          applicationPeriod: {
            startsAt: new Date('2026-07-01T00:00:00.000Z'),
            endsAt: new Date('2026-07-31T23:59:59.000Z'),
          },
          applications: {
            total: 3,
            submitted: 1,
            pendingApproval: 1,
            approved: 1,
            rejected: 1,
          },
          applicantsPath: '/programs/program%3A1/applicants',
          activity: {
            repositories: 1,
            commits: 2,
            pullRequests: 3,
            releases: 4,
            lastActivityAt: '2026-07-20T00:00:00.000Z',
            dataAsOf: '2026-07-21T00:00:00.000Z',
          },
          submissions: {
            approvedApplications: 1,
            milestones: 2,
            total: 2,
            notSubmitted: 1,
            submitted: 1,
            approved: 0,
            changesRequested: 0,
            rejected: 0,
          },
        },
      ],
    });
    const service: Pick<StaffDashboardService, 'summary'> = { summary };
    const insights = { summarize: jest.fn() };
    const controller = new StaffDashboardController(service, insights);

    // When / Then
    await expect(controller.summary()).resolves.toEqual({
      programs: [
        {
          id: 'program:1',
          name: 'Synthetic program',
          category: ProgramCategory.BASIC,
          applicationPeriod: {
            startsAt: '2026-07-01T00:00:00.000Z',
            endsAt: '2026-07-31T23:59:59.000Z',
          },
          applications: {
            total: 3,
            submitted: 1,
            pendingApproval: 1,
            approved: 1,
            rejected: 1,
          },
          applicantsPath: '/programs/program%3A1/applicants',
          activity: {
            repositories: 1,
            commits: 2,
            pullRequests: 3,
            releases: 4,
            lastActivityAt: '2026-07-20T00:00:00.000Z',
            dataAsOf: '2026-07-21T00:00:00.000Z',
          },
          submissions: {
            approvedApplications: 1,
            milestones: 2,
            total: 2,
            notSubmitted: 1,
            submitted: 1,
            approved: 0,
            changesRequested: 0,
            rejected: 0,
          },
        },
      ],
    });
    expect(summary).toHaveBeenCalledTimes(1);
  });

  it('guards insights the same way and resolves a missing year to all-time', async () => {
    const summarize = jest.fn().mockResolvedValue({
      scope: { kind: 'all' },
      dataAsOf: new Date('2026-08-01T00:00:00.000Z'),
      years: [2026],
      cohorts: [],
      departments: [],
      programs: [],
    });
    const controller = new StaffDashboardController(
      { summary: jest.fn() },
      { summarize },
    );
    const insightsSummary: unknown = Object.getOwnPropertyDescriptor(
      StaffDashboardController.prototype,
      'insightsSummary',
    )?.value;
    if (typeof insightsSummary !== 'function') {
      throw new TypeError(
        'StaffDashboardController.insightsSummary is missing',
      );
    }

    await expect(controller.insightsSummary({})).resolves.toMatchObject({
      scope: { kind: 'all' },
      years: [2026],
    });
    expect(summarize).toHaveBeenCalledWith({ kind: 'all' });
    expect(
      readGuards(StaffDashboardController.prototype, 'insightsSummary'),
    ).toEqual([SessionGuard, ApplicationsStaffListGuard]);
    expect(Reflect.getMetadata(PATH_METADATA, insightsSummary)).toBe(
      'insights',
    );
  });
});
