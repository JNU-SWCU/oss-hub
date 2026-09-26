import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import {
  prisma,
  service,
  githubId,
  programId,
  oldId,
  input,
} from '../applications/student-repository-url.integration.fixture';
import { SystemStatusRepository } from './system-status.repository';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

// 통합 DB는 스펙끼리 공유하므로 절댓값이 아니라 연결을 바꾼 전후 차이를 본다.
const status = new SystemStatusRepository(prisma);

it('drops a detached organization repository from the tracked set so its missing streams stop reading as partial', async () => {
  // Given: A is the linked organization repository and has no stream rows yet.
  const before = await status.getIncrementalStatusSnapshot();
  // When: the team links external B instead, detaching A with its team history.
  await service.updateMine(githubId, programId, input);
  // Then
  const after = await status.getIncrementalStatusSnapshot();
  expect(after.trackedRepositoryCount).toBe(before.trackedRepositoryCount - 1);
  // 저장소마다 Commit·PR·Release·Issue 네 stream이 빠진다.
  expect(after.partialStreamCount).toBe(before.partialStreamCount - 4);
});

it('counts the new external link instead of the detached external one', async () => {
  // Given: A is the linked external repository; B is not yet present.
  await prisma.githubRepository.update({
    where: { id: oldId },
    data: { source: 'EXTERNAL_PUBLIC' },
  });
  const before = await status.getExternalCollectionStatus();
  // When: B replaces A — B becomes present and linked, A keeps only its history.
  await service.updateMine(githubId, programId, input);
  // Then: B joins and A leaves, so the tracked count is unchanged.
  const after = await status.getExternalCollectionStatus();
  expect(after.trackedRepositoryCount).toBe(before.trackedRepositoryCount);
});
