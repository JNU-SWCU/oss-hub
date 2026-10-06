import {
  ApplicationStatus,
  OutboxEventStatus,
  ProgramCategory,
  RepositoryInvitationStatus,
  RepositoryProvisionJobStatus,
  RepositorySource,
  RepositoryVisibility,
} from '@prisma/client';
import {
  offsetDays,
  prisma,
  seedId,
  seedNameWithOwner,
  seedRepositoryId,
  SeedStats,
  upsertSeedUser,
  upsertTracked,
} from './helpers';
import { computeJoinCodeDigest } from '../../src/common/join-code-digest';

const PROGRAM_ID = seedId('repositories', 'program');

async function ensureProgram(stats: SeedStats): Promise<void> {
  await upsertTracked(
    stats,
    'Program',
    () => prisma.program.findUnique({ where: { id: PROGRAM_ID } }),
    () =>
      prisma.program.upsert({
        where: { id: PROGRAM_ID },
        update: {},
        create: {
          id: PROGRAM_ID,
          name: 'seed-repositories-program',
          organizer: 'seed-organizer',
          category: ProgramCategory.OSS_CONTEST,
          applicationTemplateKey: ProgramCategory.OSS_CONTEST.toLowerCase(),
          applicationTemplateVersion: 1,
          applicationStartAt: offsetDays(-80),
          applicationEndAt: offsetDays(-60),
          startAt: offsetDays(-59),

          endAt: offsetDays(-1),
          repositoryProvisioningEnabled: true,
          description: '#110 시드 fixture — repositories profile 전용',
        },
      }),
  );
}

async function ensureApplication(
  stats: SeedStats,
  scenarioId: string,
): Promise<{ applicationId: string; applicantId: string }> {
  const applicant = await upsertSeedUser(stats, {
    id: seedId('repositories', scenarioId, 'applicant'),
    role: 'STUDENT',
  });

  const teamId = seedId('repositories', scenarioId, 'team');
  await upsertTracked(
    stats,
    'Team',
    () => prisma.team.findUnique({ where: { id: teamId } }),
    () =>
      prisma.team.upsert({
        where: { id: teamId },
        update: {},
        create: {
          id: teamId,
          programId: PROGRAM_ID,
          name: `${scenarioId} 1인 팀`,
          joinCodeDigest: computeJoinCodeDigest(
            `SEED-REPOSITORIES-${scenarioId}`,
          ),
          leaderId: applicant.id,
        },
      }),
  );
  await upsertTracked(
    stats,
    'TeamMember',
    () =>
      prisma.teamMember.findUnique({
        where: { teamId_userId: { teamId, userId: applicant.id } },
      }),
    () =>
      prisma.teamMember.upsert({
        where: { teamId_userId: { teamId, userId: applicant.id } },
        update: {},
        create: {
          id: seedId('repositories', scenarioId, 'team-member'),
          teamId,
          programId: PROGRAM_ID,
          userId: applicant.id,
        },
      }),
  );
  const applicationId = seedId('repositories', scenarioId, 'application');
  await upsertTracked(
    stats,
    'Application',
    () => prisma.application.findUnique({ where: { id: applicationId } }),
    () =>
      prisma.application.upsert({
        where: { id: applicationId },
        update: {},
        create: {
          id: applicationId,
          programId: PROGRAM_ID,
          applicantId: applicant.id,
          answers: { seedPlaceholder: true, scenarioId },
          teamId,
          applicationTemplateVersion: 1,
          status: ApplicationStatus.APPROVED,
          processedAt: offsetDays(-2),
        },
      }),
  );
  return { applicationId, applicantId: applicant.id };
}

async function seedRepoJobPending(stats: SeedStats): Promise<void> {
  const scenarioId = 'repo-job-pending';
  const { applicationId } = await ensureApplication(stats, scenarioId);

  const outboxId = seedId('repositories', scenarioId, 'outbox-event');
  await upsertTracked(
    stats,
    'OutboxEvent',
    () => prisma.outboxEvent.findUnique({ where: { id: outboxId } }),
    () =>
      prisma.outboxEvent.upsert({
        where: { id: outboxId },
        update: { status: OutboxEventStatus.PROCESSED },
        create: {
          id: outboxId,
          type: 'repository.provision.requested',
          aggregateType: 'Application',
          aggregateId: applicationId,
          idempotencyKey: seedId('repositories', scenarioId, 'idempotency'),
          payload: { seedPlaceholder: true, scenarioId },
          status: OutboxEventStatus.PROCESSED,
          processedAt: offsetDays(-1),
        },
      }),
  );

  const jobId = seedId('repositories', scenarioId, 'job');
  await upsertTracked(
    stats,
    'RepositoryProvisionJob',
    () => prisma.repositoryProvisionJob.findUnique({ where: { id: jobId } }),
    () =>
      prisma.repositoryProvisionJob.upsert({
        where: { id: jobId },
        update: { status: RepositoryProvisionJobStatus.PENDING },
        create: {
          id: jobId,
          applicationId,
          status: RepositoryProvisionJobStatus.PENDING,
          nextAttemptAt: offsetDays(0),
        },
      }),
  );
}

async function seedRepoJobSucceeded(stats: SeedStats): Promise<void> {
  const scenarioId = 'repo-job-succeeded';
  const { applicationId } = await ensureApplication(stats, scenarioId);

  const repositoryId = seedId('repositories', scenarioId, 'repository');
  await upsertTracked(
    stats,
    'GithubRepository',
    () => prisma.githubRepository.findUnique({ where: { id: repositoryId } }),
    () =>
      prisma.githubRepository.upsert({
        where: { id: repositoryId },
        update: {},
        create: {
          id: repositoryId,
          applicationId,
          programId: PROGRAM_ID,
          githubRepositoryId: seedRepositoryId(scenarioId),
          nameWithOwner: seedNameWithOwner(scenarioId),
          source: RepositorySource.ORG_PROVISIONED,
          visibility: RepositoryVisibility.PRIVATE,
        },
      }),
  );

  const jobId = seedId('repositories', scenarioId, 'job');
  await upsertTracked(
    stats,
    'RepositoryProvisionJob',
    () => prisma.repositoryProvisionJob.findUnique({ where: { id: jobId } }),
    () =>
      prisma.repositoryProvisionJob.upsert({
        where: { id: jobId },
        update: { status: RepositoryProvisionJobStatus.SUCCEEDED },
        create: {
          id: jobId,
          applicationId,
          repositoryId,
          status: RepositoryProvisionJobStatus.SUCCEEDED,
          nextAttemptAt: offsetDays(-1),
          startedAt: offsetDays(-1),
          finishedAt: offsetDays(-1),
        },
      }),
  );
}

async function seedRepoJobFailedRetryable(stats: SeedStats): Promise<void> {
  const scenarioId = 'repo-job-failed-retryable';
  const { applicationId } = await ensureApplication(stats, scenarioId);

  const jobId = seedId('repositories', scenarioId, 'job');
  await upsertTracked(
    stats,
    'RepositoryProvisionJob',
    () => prisma.repositoryProvisionJob.findUnique({ where: { id: jobId } }),
    () =>
      prisma.repositoryProvisionJob.upsert({
        where: { id: jobId },
        update: {
          status: RepositoryProvisionJobStatus.FAILED_RETRYABLE,
          attemptCount: 2,
        },
        create: {
          id: jobId,
          applicationId,
          status: RepositoryProvisionJobStatus.FAILED_RETRYABLE,
          attemptCount: 2,
          lastErrorCode: 'PROVISION_TIMEOUT',
          lastErrorMessage: 'seed fixture: 저장소 생성 타임아웃',
          nextAttemptAt: offsetDays(1),
        },
      }),
  );
}

async function seedRepositoryReady(stats: SeedStats): Promise<void> {
  const scenarioId = 'repository-ready';
  const { applicationId, applicantId } = await ensureApplication(
    stats,
    scenarioId,
  );

  const repositoryId = seedId('repositories', scenarioId, 'repository');
  await upsertTracked(
    stats,
    'GithubRepository',
    () => prisma.githubRepository.findUnique({ where: { id: repositoryId } }),
    () =>
      prisma.githubRepository.upsert({
        where: { id: repositoryId },
        update: {},
        create: {
          id: repositoryId,
          applicationId,
          programId: PROGRAM_ID,
          githubRepositoryId: seedRepositoryId(scenarioId),
          nameWithOwner: seedNameWithOwner(scenarioId),
          source: RepositorySource.ORG_PROVISIONED,
          visibility: RepositoryVisibility.PRIVATE,
        },
      }),
  );

  const invitationId = seedId('repositories', scenarioId, 'invitation');
  const invitedUser = await prisma.user.findUnique({
    where: { id: applicantId },
  });
  const githubLogin = invitedUser?.nickname ?? `seed-${scenarioId}-invitee`;
  await upsertTracked(
    stats,
    'RepositoryInvitation',
    () =>
      prisma.repositoryInvitation.findUnique({ where: { id: invitationId } }),
    () =>
      prisma.repositoryInvitation.upsert({
        where: { id: invitationId },
        update: { status: RepositoryInvitationStatus.PENDING },
        create: {
          id: invitationId,
          repositoryId,
          githubLogin,
          status: RepositoryInvitationStatus.PENDING,
          attemptCount: 1,
        },
      }),
  );
}

async function seedRepositoryPublic(stats: SeedStats): Promise<void> {
  const scenarioId = 'repository-public';
  const { applicationId } = await ensureApplication(stats, scenarioId);

  const repositoryId = seedId('repositories', scenarioId, 'repository');
  await upsertTracked(
    stats,
    'GithubRepository',
    () => prisma.githubRepository.findUnique({ where: { id: repositoryId } }),
    () =>
      prisma.githubRepository.upsert({
        where: { id: repositoryId },
        update: { publishedAt: null },
        create: {
          id: repositoryId,
          applicationId,
          programId: PROGRAM_ID,
          githubRepositoryId: seedRepositoryId(scenarioId),
          nameWithOwner: seedNameWithOwner(scenarioId),
          source: RepositorySource.ORG_PROVISIONED,
          visibility: RepositoryVisibility.PUBLIC,
          publishedAt: null,
        },
      }),
  );
}

export async function seedRepositories(stats: SeedStats): Promise<void> {
  await ensureProgram(stats);
  await seedRepoJobPending(stats);
  await seedRepoJobSucceeded(stats);
  await seedRepoJobFailedRetryable(stats);
  await seedRepositoryReady(stats);
  await seedRepositoryPublic(stats);
}
