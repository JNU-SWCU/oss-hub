import { StudentRepositoryUrlService } from './student-repository-url.service';
import { ApplicationStatus } from '@prisma/client';

const studentRepositoryUrlService = new StudentRepositoryUrlService(
  {} as never,
  {} as never,
  {} as never,
  {} as never,
  {} as never,
  {} as never,
  {} as never,
);

describe('program-participant', () => {
  describe('student repository URL edit permission', () => {
    const endAt = new Date('2026-09-01T00:00:00Z');
    it.each([
      [
        ApplicationStatus.APPROVED,
        true,
        new Date('2026-08-31T23:59:59Z'),
        true,
      ],
      [ApplicationStatus.APPROVED, true, endAt, false],
      [ApplicationStatus.APPROVED, false, new Date('2026-08-01'), false],
      [ApplicationStatus.SUBMITTED, true, new Date('2026-08-01'), false],
      [ApplicationStatus.REJECTED, true, new Date('2026-08-01'), false],
    ])(
      'checks status %s manager %s at %s',
      (status, isManager, now, expected) => {
        const context = { status, endAt, isManager };
        const result = studentRepositoryUrlService.canEditStudentRepositoryUrl(
          context,
          now,
        );
        expect(result).toBe(expected);
      },
    );
  });
});
