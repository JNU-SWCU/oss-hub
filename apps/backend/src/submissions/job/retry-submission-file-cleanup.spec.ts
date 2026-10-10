import { MemberKind } from '@prisma/client';
import { NestFactory } from '@nestjs/core';
import { AuditLogService } from '../../audit-log/service/audit-log.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SubmissionFileCleanupRetryService } from '../service/submission-file-cleanup-retry.service';
import { SubmissionFilesRepository } from '../repository/submission-files.repository';
import { main } from './retry-submission-file-cleanup';

jest.mock('@nestjs/core', () => ({
  NestFactory: { createApplicationContext: jest.fn() },
}));
jest.mock('../../app.module', () => ({ AppModule: class AppModule {} }));

const FILE_ID = 'synthetic-file-id';
const OPERATOR_ID = 'synthetic-operator-id';

interface Harness {
  record: jest.Mock;
  resetDeleteAttempts: jest.SpyInstance;
  updateMany: jest.Mock;
  findUnique: jest.Mock;
  close: jest.Mock;
}

function installContext(): Harness {
  const record = jest.fn().mockResolvedValue({});
  const updateMany = jest.fn().mockResolvedValue({ count: 1 });
  const findUnique = jest.fn().mockResolvedValue({
    githubId: 4242n,
    hasAdminAccess: true,
    accountStatus: 'ACTIVE',
  });
  const close = jest.fn().mockResolvedValue(undefined);
  const files = new SubmissionFilesRepository({
    user: { findUnique },
    submissionFile: { updateMany },
  } as unknown as PrismaService);
  const resetDeleteAttempts = jest.spyOn(files, 'resetDeleteAttempts');
  const retry = new SubmissionFileCleanupRetryService(files, {
    record,
  } as unknown as AuditLogService);
  const context = {
    close,
    get: (token: unknown): unknown => {
      if (token === SubmissionFileCleanupRetryService) return retry;
      throw new Error('unexpected provider token');
    },
  };
  (
    NestFactory.createApplicationContext as unknown as jest.Mock
  ).mockResolvedValue(context);
  return { record, resetDeleteAttempts, updateMany, findUnique, close };
}

describe('submissions:retry-file-cleanup CLI — #547 감사 기록', () => {
  const originalArgv = process.argv;
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.argv = ['node', 'cli', FILE_ID];
    process.env = {
      ...originalEnv,
      SUBMISSION_FILE_CLEANUP_MAINTENANCE_ENABLED: '1',
      SUBMISSION_FILE_CLEANUP_OPERATOR_ID: OPERATOR_ID,
    };
  });

  afterAll(() => {
    process.argv = originalArgv;
    process.env = originalEnv;
  });

  it('reset이 성공하면 typed audit action을 남긴다', async () => {
    const harness = installContext();

    await main();

    expect(harness.findUnique).toHaveBeenCalledWith({
      where: { id: OPERATOR_ID },
      select: { githubId: true, hasAdminAccess: true, accountStatus: true },
    });
    expect(harness.resetDeleteAttempts).toHaveBeenCalledWith(
      FILE_ID,
      expect.any(Date),
    );
    expect(harness.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: FILE_ID }) as unknown,
        data: expect.objectContaining({
          deleteAttemptCount: 0,
          nextDeleteAttemptAt: expect.any(Date) as unknown,
        }) as unknown,
      }),
    );
    expect(harness.record).toHaveBeenCalledWith({
      actorGithubId: 4242n,
      action: 'SUBMISSION_FILE_CLEANUP_RETRY_RESET',
      targetType: 'SUBMISSION_FILE',
      targetId: FILE_ID,
      metadata: { schemaVersion: 1, fileId: FILE_ID },
    });
  });

  it('reset 대상이 없으면 감사 기록을 남기지 않는다', async () => {
    const harness = installContext();
    harness.updateMany.mockResolvedValue({ count: 0 });

    await expect(main()).rejects.toThrow('Cleanup retry target is unavailable');

    expect(harness.resetDeleteAttempts).toHaveBeenCalledWith(
      FILE_ID,
      expect.any(Date),
    );
    expect(harness.record).not.toHaveBeenCalled();
    expect(harness.close).toHaveBeenCalled();
  });

  it('권한 없는 operator는 감사 기록도 reset도 남기지 않는다', async () => {
    const harness = installContext();
    harness.findUnique.mockResolvedValue({
      githubId: 4242n,
      selectedMemberKind: MemberKind.STAFF,
      hasStaffAccess: true,
      accountStatus: 'ACTIVE',
    });

    await expect(main()).rejects.toThrow(
      'Operator is not authorized for cleanup maintenance',
    );

    expect(harness.resetDeleteAttempts).not.toHaveBeenCalled();
    expect(harness.updateMany).not.toHaveBeenCalled();
    expect(harness.record).not.toHaveBeenCalled();
    expect(harness.close).toHaveBeenCalled();
  });
});
