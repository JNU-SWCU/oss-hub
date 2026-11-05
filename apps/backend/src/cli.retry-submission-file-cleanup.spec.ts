import { PlatformRepository } from './platform/platform.repository';
import { NestFactory } from '@nestjs/core';
import { AuditLogService } from './platform/audit-log.service';
import { PrismaService } from './platform/prisma.service';
import { SubmissionFileCleanupRetryService } from './programs/submission-file-cleanup.service';
import { SubmissionFilesRepository } from './programs/submission-files.repository';
import { retrySubmissionFileCleanup } from './cli';
import { AuditLogMetadataService } from './platform/audit-log-metadata.service';
import { AuditLogRepository } from './platform/audit-log.repository';
import { AuditLogReadService } from './platform/audit-log-read.service';
jest.mock('@nestjs/core', () => ({
  NestFactory: { createApplicationContext: jest.fn() },
}));
jest.mock('./app.module', () => ({ AppModule: class AppModule {} }));
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
    admin: { userId: OPERATOR_ID },
    accountStatus: 'ACTIVE',
  });
  const close = jest.fn().mockResolvedValue(undefined);
  const prisma = new PrismaService();
  jest.spyOn(prisma.user, 'findUnique').mockImplementation(findUnique);
  jest
    .spyOn(prisma.submissionFile, 'updateMany')
    .mockImplementation(updateMany);
  const files = new SubmissionFilesRepository(prisma, new PlatformRepository());
  const resetDeleteAttempts = jest.spyOn(files, 'resetDeleteAttempts');
  const metadata = new AuditLogMetadataService();
  const audit = new AuditLogService(
    new AuditLogRepository(prisma),
    new AuditLogReadService(metadata),
  );
  jest.spyOn(audit, 'record').mockImplementation(record);
  const retry = new SubmissionFileCleanupRetryService(files, audit, metadata);
  const context = {
    close,
    get: (token: unknown): unknown => {
      if (token === SubmissionFileCleanupRetryService) return retry;
      throw new Error('unexpected provider token');
    },
  };
  jest
    .spyOn(NestFactory, 'createApplicationContext')
    .mockImplementation(jest.fn().mockResolvedValue(context));
  return { record, resetDeleteAttempts, updateMany, findUnique, close };
}
describe('submissions:retry-file-cleanup CLI — #547 감사 기록', () => {
  const originalEnv = process.env;
  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      SUBMISSION_FILE_CLEANUP_MAINTENANCE_ENABLED: '1',
      SUBMISSION_FILE_CLEANUP_OPERATOR_ID: OPERATOR_ID,
    };
  });
  afterAll(() => {
    process.env = originalEnv;
  });
  it('reset이 성공하면 typed audit action을 남긴다', async () => {
    const harness = installContext();
    await retrySubmissionFileCleanup([FILE_ID]);
    expect(harness.findUnique).toHaveBeenCalledWith({
      where: { id: OPERATOR_ID },
      select: {
        githubId: true,
        admin: { select: { userId: true } },
        accountStatus: true,
      },
    });
    expect(harness.resetDeleteAttempts).toHaveBeenCalledWith(
      FILE_ID,
      expect.any(Date),
    );
    const nextDeleteAttemptAt: unknown = expect.any(Date);
    const where: unknown = expect.objectContaining({ id: FILE_ID });
    const data: unknown = expect.objectContaining({
      deleteAttemptCount: 0,
      nextDeleteAttemptAt,
    });
    expect(harness.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where, data }),
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
    await expect(retrySubmissionFileCleanup([FILE_ID])).rejects.toThrow(
      'Cleanup retry target is unavailable',
    );
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
      admin: null,
      accountStatus: 'ACTIVE',
    });
    await expect(retrySubmissionFileCleanup([FILE_ID])).rejects.toThrow(
      'Operator is not authorized for cleanup maintenance',
    );
    expect(harness.resetDeleteAttempts).not.toHaveBeenCalled();
    expect(harness.updateMany).not.toHaveBeenCalled();
    expect(harness.record).not.toHaveBeenCalled();
    expect(harness.close).toHaveBeenCalled();
  });
});
