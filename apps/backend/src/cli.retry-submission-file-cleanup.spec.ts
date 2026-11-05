import {
  FileMetadataRepository,
  FilesRepository,
} from './programs/files.repository';
import { PlatformRepository } from './platform/platform.repository';
import { NestFactory } from '@nestjs/core';
import { PrismaService } from './platform/prisma.service';
import { FileCleanupRetryService } from './programs/file-cleanup.service';
import { retrySubmissionFileCleanup } from './cli';

jest.mock('@nestjs/core', () => ({
  NestFactory: { createApplicationContext: jest.fn() },
}));
jest.mock('./app.module', () => ({ AppModule: class AppModule {} }));
const FILE_ID = 'synthetic-file-id';
const OPERATOR_ID = 'synthetic-operator-id';
interface Harness {
  resetDeleteAttempts: jest.SpyInstance;
  updateMany: jest.Mock;
  findUnique: jest.Mock;
  close: jest.Mock;
}
function installContext(): Harness {
  const updateMany = jest.fn().mockResolvedValue({ count: 1 });
  const findUnique = jest.fn().mockResolvedValue({
    githubId: 4242n,
    admin: { userId: OPERATOR_ID },
    accountStatus: 'ACTIVE',
  });
  const close = jest.fn().mockResolvedValue(undefined);
  const prisma = new PrismaService();
  jest.spyOn(prisma.user, 'findUnique').mockImplementation(findUnique);
  jest.spyOn(prisma.file, 'updateMany').mockImplementation(updateMany);
  const files = new FilesRepository(
    prisma,
    new PlatformRepository(),
    new FileMetadataRepository(),
  );
  const resetDeleteAttempts = jest.spyOn(files, 'resetDeleteAttempts');
  const retry = new FileCleanupRetryService(files);
  const context = {
    close,
    get: (token: unknown): unknown => {
      if (token === FileCleanupRetryService) return retry;
      throw new Error('unexpected provider token');
    },
  };
  jest
    .spyOn(NestFactory, 'createApplicationContext')
    .mockImplementation(jest.fn().mockResolvedValue(context));
  return { resetDeleteAttempts, updateMany, findUnique, close };
}
describe('submissions:retry-file-cleanup CLI', () => {
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
  it('operator가 유효하면 대상 파일의 삭제 시도를 초기화한다', async () => {
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
  });
  it('reset 대상이 없으면 실패로 끝낸다', async () => {
    const harness = installContext();
    harness.updateMany.mockResolvedValue({ count: 0 });
    await expect(retrySubmissionFileCleanup([FILE_ID])).rejects.toThrow(
      'Cleanup retry target is unavailable',
    );
    expect(harness.resetDeleteAttempts).toHaveBeenCalledWith(
      FILE_ID,
      expect.any(Date),
    );
    expect(harness.close).toHaveBeenCalled();
  });
  it('권한 없는 operator는 reset을 남기지 않는다', async () => {
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
    expect(harness.close).toHaveBeenCalled();
  });
});
