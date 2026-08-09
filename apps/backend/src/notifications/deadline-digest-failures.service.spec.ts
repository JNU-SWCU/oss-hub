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

  it('returns only stable public-safe failure details to an active administrator', async () => {
    const providerDetail =
      'SMTP rejected synthetic-recipient@example.test token=synthetic-secret-token';
    findActiveAdmin.mockResolvedValue(true);
    findFailedNotifications.mockResolvedValue([
      {
        id: 'notification-1',
        createdAt: new Date('2026-08-03T00:00:00.000Z'),
        payload: { milestoneCount: 1, error: providerDetail },
      },
    ]);

    const failures = await service.listFailures(1n);

    expect(failures).toEqual([
      {
        id: 'notification-1',
        createdAt: '2026-08-03T00:00:00.000Z',
        code: 'MAIL_DELIVERY_FAILED',
        message: '메일 발송에 실패했습니다.',
      },
    ]);
    expect(JSON.stringify(failures)).not.toContain(providerDetail);
    expect(JSON.stringify(failures)).not.toContain('synthetic-secret-token');
  });

  it('rejects non-administrators before reading failures', async () => {
    findActiveAdmin.mockResolvedValue(false);

    await expect(service.listFailures(1n)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(findFailedNotifications).not.toHaveBeenCalled();
  });
});
