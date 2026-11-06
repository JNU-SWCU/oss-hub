import { UserProfileService } from '../users/user-profile.service';
import { ProgramScheduleService } from './program-schedule.service';
import {
  SubmissionFileAdmissionService,
  ProgramAuthoringUploadService,
} from './files.service';
import {
  ProgramCoverRepository,
  ProgramAuthoringUploadTransactionRepository,
} from './files.repository';
import { ProgramNoticeFetchClient } from './program-notice-fetch.client';
import { ProgramDeletionScopeRepository } from './programs.repository';
import { LockProgramTreeRepository } from '../platform/lock-program-tree.repository';
import { ProgramCategory } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { DomainException } from '../platform/error-code.error';
import { PrismaService } from '../platform/prisma.service';
import { ProgramEditorRepository } from './program-editor.repository';
import { ProgramEditorService } from './program-editor.service';
import { ProgramCoverUrlService } from './programs.service';

export const TEST_PREFIX = 'test:101:program-editor:concurrency:';
export const STAFF_GITHUB_ID = 9101000001n;
const PROGRAM_NAME = 'Issue 101 Same Name Program';
export const prisma = new PrismaService();
export const editor = new ProgramEditorService(
  new ProgramEditorRepository(
    prisma,
    new LockProgramTreeRepository(),
    new ProgramDeletionScopeRepository(),
    new ProgramAuthoringUploadTransactionRepository(),
    new ProgramCoverRepository(
      prisma,
      new ProgramAuthoringUploadTransactionRepository(),
    ),
  ),
  new ProgramCoverUrlService(),
  new ProgramScheduleService(),
  new ProgramAuthoringUploadService(
    {} as never,
    {} as never,
    new SubmissionFileAdmissionService(),
    new ProgramNoticeFetchClient(),
  ),
  new UserProfileService(),
);
export async function runTogether<T, U>(
  first: () => Promise<T>,
  second: () => Promise<U>,
): Promise<readonly [PromiseSettledResult<T>, PromiseSettledResult<U>]> {
  let releaseBarrier: (() => void) | undefined;
  const barrier = new Promise<void>((resolve) => {
    releaseBarrier = resolve;
  });
  const firstPromise = barrier.then(first);
  const secondPromise = barrier.then(second);
  if (releaseBarrier === undefined) {
    throw new Error('Concurrent start barrier was not initialized');
  }
  releaseBarrier();
  return Promise.allSettled([firstPromise, secondPromise]);
}
export function domainCode(error: unknown): string | null {
  return error instanceof DomainException ? error.errorCode.code : null;
}
export async function createProgram(
  programId: string,
  repositoryProvisioningEnabled: boolean,
): Promise<void> {
  await prisma.program.create({
    data: {
      id: programId,
      name: PROGRAM_NAME,
      organizer: 'OSS Center',
      category: ProgramCategory.BASIC,
      applicationTemplateKey: 'basic',
      applicationTemplateVersion: 1,
      applicationStartAt: new Date('2026-08-01T00:00:00.000Z'),
      applicationEndAt: new Date('2026-08-15T00:00:00.000Z'),
      startAt: new Date('2026-08-16T00:00:00.000Z'),
      endAt: new Date('2026-08-31T00:00:00.000Z'),
      repositoryProvisioningEnabled,
      description: 'Issue 101 program',
    },
  });
}
export async function createMilestone(
  milestoneId: string,
  programId: string,
): Promise<void> {
  await prisma.milestone.create({
    data: {
      id: milestoneId,
      programId,
      name: 'Issue 101 Same Name Milestone',
      startAt: new Date('2026-08-16T00:00:00.000Z'),
      dueAt: new Date('2026-08-20T00:00:00.000Z'),
      instructions: 'Issue 101 milestone',
    },
  });
}
export async function cleanup(): Promise<void> {
  const milestones = await prisma.milestone.findMany({
    where: { id: { startsWith: `${TEST_PREFIX}milestone:` } },
    select: { id: true },
  });
  const milestoneIds = milestones.map((milestone) => milestone.id);
  const documents = await prisma.requirement.findMany({
    where: { milestoneId: { in: milestoneIds } },
    select: { id: true },
  });
  const documentIds = documents.map((document) => document.id);
  const documentSubmissions = await prisma.submission.findMany({
    where: {
      OR: [
        { teamId: { startsWith: `${TEST_PREFIX}application:` } },
        { requirementId: { in: documentIds } },
      ],
    },
    select: { id: true },
  });
  const documentSubmissionIds = documentSubmissions.map(
    (submission) => submission.id,
  );
  const documentSubmissionHistories = await prisma.submissionHistory.findMany({
    where: {
      submissionId: { in: documentSubmissionIds },
    },
    select: { id: true },
  });
  const documentSubmissionHistoryIds = documentSubmissionHistories.map(
    (history) => history.id,
  );
  await prisma.file.deleteMany({
    where: {
      kind: 'SUBMISSION',
      OR: [
        { teamId: { startsWith: `${TEST_PREFIX}application:` } },
        {
          kind: 'SUBMISSION',
          requirement: {
            milestoneId: { startsWith: `${TEST_PREFIX}milestone:` },
          },
        },
        { kind: 'SUBMISSION', submissionId: { in: documentSubmissionIds } },
        {
          kind: 'SUBMISSION',
          submissionHistoryId: {
            in: documentSubmissionHistoryIds,
          },
        },
      ],
    },
  });
  await prisma.submissionHistory.deleteMany({
    where: { id: { in: documentSubmissionHistoryIds } },
  });
  await prisma.submission.deleteMany({
    where: { id: { in: documentSubmissionIds } },
  });
  await prisma.team.deleteMany({
    where: { id: { startsWith: `${TEST_PREFIX}application:` } },
  });
  await prisma.team.deleteMany({
    where: { id: { startsWith: `${TEST_PREFIX}team:` } },
  });
  await prisma.file.deleteMany({
    where: { kind: 'TEMPLATE', requirementId: { in: documentIds } },
  });
  await prisma.requirement.deleteMany({
    where: { id: { in: documentIds } },
  });
  await prisma.milestone.deleteMany({
    where: { id: { in: milestoneIds } },
  });
  await prisma.program.deleteMany({
    where: { id: { startsWith: `${TEST_PREFIX}program:` } },
  });
  await prisma.file.deleteMany({
    where: { kind: 'UPLOAD', uploaderId: { startsWith: TEST_PREFIX } },
  });
  await prisma.user.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
}
export async function installSyntheticAggregateFaultTrigger(input: {
  readonly table: 'Milestone' | 'Requirement' | 'File';
  readonly event: 'INSERT' | 'UPDATE' | 'DELETE';
  readonly targetColumn: 'id' | 'milestoneId' | 'requirementId';
  readonly targetId: string;
  readonly deferred?: boolean;
}): Promise<() => Promise<void>> {
  const suffix = randomUUID().replaceAll('-', '');
  const functionName = `test_aggregate_fault_fn_${suffix}`;
  const triggerName = `test_aggregate_fault_tr_${suffix}`;
  const row = input.event === 'DELETE' ? 'OLD' : 'NEW';
  const escapedTarget = input.targetId.replaceAll("'", "''");
  await prisma.$executeRawUnsafe(`
    CREATE FUNCTION "${functionName}"() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF ${row}."${input.targetColumn}" = '${escapedTarget}' THEN
        RAISE EXCEPTION 'synthetic aggregate fault';
      END IF;
      RETURN ${row};
    END;
    $$;
  `);
  try {
    await prisma.$executeRawUnsafe(`
      CREATE ${input.deferred ? 'CONSTRAINT ' : ''}TRIGGER "${triggerName}"
      AFTER ${input.event} ON "${input.table}"
      ${input.deferred ? 'DEFERRABLE INITIALLY DEFERRED' : ''}
      FOR EACH ROW EXECUTE FUNCTION "${functionName}"();
    `);
  } catch (error) {
    await prisma.$executeRawUnsafe(
      `DROP FUNCTION IF EXISTS "${functionName}"()`,
    );
    throw error;
  }
  return async () => {
    await prisma.$executeRawUnsafe(
      `DROP TRIGGER IF EXISTS "${triggerName}" ON "${input.table}"`,
    );
    await prisma.$executeRawUnsafe(
      `DROP FUNCTION IF EXISTS "${functionName}"()`,
    );
  };
}
