import { ForbiddenException } from '@nestjs/common';
import { DeadlineDigestFailuresService } from './deadline-digest-failures.service';
import { DeadlineDigestRepository } from './deadline-digest.repository';

describe('DeadlineDigestFailuresService', () => {
  const findActiveAdmin = jest.fn();
  const findFailedNotifications = jest.fn();
  const repository = {
    findActiveAdmin,
    findFailedNotifications,
  } as unknown as DeadlineDigestRepository;
  const service = new DeadlineDigestFailuresService(repository);

  beforeEach(() => {
    findActiveAdmin.mockReset();
    findFailedNotifications.mockReset();
  });

  it('returns failed digest ledger entries to an active administrator', async () => {
    findActiveAdmin.mockResolvedValue(true);
    findFailedNotifications.mockResolvedValue([
      {
        id: 'notification-1',
        createdAt: new Date('2026-08-03T00:00:00.000Z'),
        payload: { milestoneCount: 1, error: 'smtp down' },
      },
    ]);

    await expect(service.listFailures(1n)).resolves.toEqual([
      {
        id: 'notification-1',
        createdAt: '2026-08-03T00:00:00.000Z',
        error: 'smtp down',
      },
    ]);
  });

  it('rejects non-administrators before reading failures', async () => {
    findActiveAdmin.mockResolvedValue(false);

    await expect(service.listFailures(1n)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(findFailedNotifications).not.toHaveBeenCalled();
  });
});
