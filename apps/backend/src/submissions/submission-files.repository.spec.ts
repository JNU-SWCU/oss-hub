import { AccountStatus, Role, SubmissionFileLifecycle } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { SubmissionFilesRepository } from './submission-files.repository';

describe('SubmissionFilesRepository exhausted cleanup query', () => {
  const findMany = jest.fn();
  const findUnique = jest.fn();
  const prisma = {
    submissionFile: { findMany },
    user: { findUnique },
  } as unknown as PrismaService;
  const repository = new SubmissionFilesRepository(prisma);

  beforeEach(() => {
    findMany.mockReset();
    findUnique.mockReset();
    findMany.mockResolvedValue([]);
  });

  it('selects only operator-safe columns and filters to retry-exhausted DELETE_PENDING rows', async () => {
    // When
    await repository.findExhaustedCleanups();

    // Then
    const calls = findMany.mock.calls as unknown[][];
    const args = calls[0]![0] as {
      where: Record<string, unknown>;
      select: Record<string, boolean>;
    };
    expect(args.where).toEqual({
      lifecycle: SubmissionFileLifecycle.DELETE_PENDING,
      deleteAttemptCount: { gte: 6 },
    });
    expect(Object.keys(args.select).sort()).toEqual([
      'createdAt',
      'deleteAttemptCount',
      'id',
      'lastDeleteError',
    ]);
  });

  it('treats only ACTIVE administrators as authorized operators', async () => {
    // Given / When / Then
    findUnique.mockResolvedValueOnce({
      role: Role.ADMIN,
      accountStatus: AccountStatus.ACTIVE,
    });
    await expect(repository.findActiveAdminByGithubId(1n)).resolves.toBe(true);

    findUnique.mockResolvedValueOnce({
      role: Role.STAFF,
      accountStatus: AccountStatus.ACTIVE,
    });
    await expect(repository.findActiveAdminByGithubId(2n)).resolves.toBe(false);

    findUnique.mockResolvedValueOnce({
      role: Role.ADMIN,
      accountStatus: AccountStatus.DEACTIVATED,
    });
    await expect(repository.findActiveAdminByGithubId(3n)).resolves.toBe(false);

    findUnique.mockResolvedValueOnce(null);
    await expect(repository.findActiveAdminByGithubId(4n)).resolves.toBe(false);
  });
});
