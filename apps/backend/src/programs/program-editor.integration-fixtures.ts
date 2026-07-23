import {
  MilestoneSubmissionType,
  ProgramCategory,
  Role,
} from '@prisma/client';
import { DomainException } from '../common/error-code';
import { PrismaService } from '../prisma/prisma.service';
import { ProgramEditorRepository } from './program-editor.repository';
import { ProgramEditorService } from './program-editor.service';
import { ProgramsRepository } from './programs.repository';
import { ProgramsService } from './programs.service';

export const TEST_PREFIX = 'test:101:program-editor:concurrency:';
export const STAFF_GITHUB_ID = 9_101_000_001n;
export const PROGRAM_NAME = 'Issue 101 Same Name Program';
export const NOW = new Date('2026-08-18T00:00:00.000Z');
export const STAFF_VIEWER = {
  githubId: STAFF_GITHUB_ID,
  userId: `${TEST_PREFIX}staff`,
  role: Role.STAFF,
} as const;

export const prisma = new PrismaService();
export const editor = new ProgramEditorService(
  new ProgramEditorRepository(prisma),
);
export const programs = new ProgramsService(new ProgramsRepository(prisma));

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
      dueAt: new Date('2026-08-20T00:00:00.000Z'),
      submissionType: MilestoneSubmissionType.TEXT,
      instructions: 'Issue 101 milestone',
    },
  });
}

export async function cleanup(): Promise<void> {
  await prisma.submissionRevision.deleteMany({
    where: { id: { startsWith: `${TEST_PREFIX}submission-revision:` } },
  });
  await prisma.submission.deleteMany({
    where: { id: { startsWith: `${TEST_PREFIX}submission:` } },
  });
  await prisma.application.deleteMany({
    where: { id: { startsWith: `${TEST_PREFIX}application:` } },
  });
  await prisma.milestone.deleteMany({
    where: { id: { startsWith: `${TEST_PREFIX}milestone:` } },
  });
  await prisma.program.deleteMany({
    where: { id: { startsWith: `${TEST_PREFIX}program:` } },
  });
  await prisma.user.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
}
