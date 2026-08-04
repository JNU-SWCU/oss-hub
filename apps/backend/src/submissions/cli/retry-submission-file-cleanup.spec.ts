import { NestFactory } from '@nestjs/core';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SubmissionFilesRepository } from '../submission-files.repository';
import { main } from './retry-submission-file-cleanup';

jest.mock('@nestjs/core', () => ({
  NestFactory: { createApplicationContext: jest.fn() },
}));
jest.mock('../../app.module', () => ({ AppModule: class AppModule {} }));

/**
 * #547 — ADMIN 파일 정리 재시도 reset은 actor가 명확한 권한 조작인데 감사 기록이 없었다.
 */
const FILE_ID = 'synthetic-file-id';
const OPERATOR_ID = 'synthetic-operator-id';

interface Harness {
  record: jest.Mock;
  resetDeleteAttempts: jest.Mock;
  findUnique: jest.Mock;
  close: jest.Mock;
}

function installContext(): Harness {
  const record = jest.fn().mockResolvedValue({});
  const resetDeleteAttempts = jest.fn().mockResolvedValue(true);
  const findUnique = jest.fn().mockResolvedValue({
    githubId: 4242n,
    role: 'ADMIN',
    accountStatus: 'ACTIVE',
  });
  const close = jest.fn().mockResolvedValue(undefined);
  const context = {
    close,
    get: (token: unknown): unknown => {
      if (token === PrismaService) return { user: { findUnique } };
      if (token === SubmissionFilesRepository) return { resetDeleteAttempts };
      if (token === AuditLogService) return { record };
      throw new Error('unexpected provider token');
    },
  };
  (
    NestFactory.createApplicationContext as unknown as jest.Mock
  ).mockResolvedValue(context);
  return { record, resetDeleteAttempts, findUnique, close };
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

    expect(harness.resetDeleteAttempts).toHaveBeenCalledWith(
      FILE_ID,
      expect.any(Date),
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
    harness.resetDeleteAttempts.mockResolvedValue(false);

    await expect(main()).rejects.toThrow('Cleanup retry target is unavailable');

    expect(harness.record).not.toHaveBeenCalled();
    expect(harness.close).toHaveBeenCalled();
  });

  it('권한 없는 operator는 감사 기록도 reset도 남기지 않는다', async () => {
    const harness = installContext();
    harness.findUnique.mockResolvedValue({
      githubId: 4242n,
      role: 'STAFF',
      accountStatus: 'ACTIVE',
    });

    await expect(main()).rejects.toThrow(
      'Operator is not authorized for cleanup maintenance',
    );

    expect(harness.resetDeleteAttempts).not.toHaveBeenCalled();
    expect(harness.record).not.toHaveBeenCalled();
  });
});
