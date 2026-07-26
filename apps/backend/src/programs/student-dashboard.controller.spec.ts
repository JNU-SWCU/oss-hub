import { GUARDS_METADATA } from '@nestjs/common/constants';
import { SessionGuard } from '../auth/session.guard';
import { ProgramActivityService } from './program-activity.service';
import { ProgramViewerService } from './program-viewer.service';
import { StudentDashboardController } from './programs.controller';
import { StudentDashboardService } from './student-dashboard.service';

const DUE_AT = new Date('2026-08-01T00:00:00.000Z');

function handler(): (...args: unknown[]) => unknown {
  const method: unknown = Object.getOwnPropertyDescriptor(
    StudentDashboardController.prototype,
    'dashboardSummary',
  )?.value;
  if (typeof method !== 'function') throw new Error('handler must exist');
  return method as (...args: unknown[]) => unknown;
}

describe('StudentDashboardController', () => {
  it('forwards the session github id and serializes milestone dates', async () => {
    const dashboard = {
      getStudentDashboard: jest.fn().mockResolvedValue([
        {
          applicationId: 'application-1',
          programId: 'program-1',
          programName: 'Synthetic Program',
          applicationMode: 'PERSONAL' as const,
          displayName: 'Synthetic Applicant',
          applicationStatus: 'APPROVED' as const,
          nextMilestone: {
            id: 'milestone-1',
            name: 'Synthetic milestone',
            dueAt: DUE_AT,
            submissionStatus: 'NOT_SUBMITTED' as const,
          },
          detailUrl: '/programs/program-1',
          checklistUrl: '/programs/program-1/submissions',
        },
      ]),
    } as jest.Mocked<Pick<StudentDashboardService, 'getStudentDashboard'>>;
    const controller = new StudentDashboardController(
      dashboard,
      {} as ProgramActivityService,
      {} as ProgramViewerService,
    );

    const response = await controller.dashboardSummary({
      sessionGithubId: 123n,
    });

    expect(dashboard.getStudentDashboard).toHaveBeenCalledWith(123n);
    expect(response.items[0]?.nextMilestone?.dueAt).toBe(DUE_AT.toISOString());
  });

  it('keeps unauthenticated handling with SessionGuard metadata', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, handler())).toEqual([
      SessionGuard,
    ]);
  });
});
