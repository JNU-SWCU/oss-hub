import { PrismaClient } from '@prisma/client';

import { assertIsolatedIntegrationDatabase } from '../test/integration-database.guard';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const DATABASE_CONNECTION_TIMEOUT_MS = 60_000;
const TEST_PREFIX = 'test:177:';
const INVENTORY_ID = `${TEST_PREFIX}inventory`;
const EVENT_ID = `${TEST_PREFIX}event`;
const USER_ID = `${TEST_PREFIX}user`;

const prisma = new PrismaClient();

async function cleanFixtures(): Promise<void> {
  await prisma.orgRepositoryActivityEvent.deleteMany({
    where: { id: { startsWith: TEST_PREFIX } },
  });
  await prisma.orgRepositoryInventory.deleteMany({
    where: { id: { startsWith: TEST_PREFIX } },
  });
  await prisma.user.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
}

async function createInventory(): Promise<void> {
  await prisma.orgRepositoryInventory.create({
    data: {
      id: INVENTORY_ID,
      githubRepositoryId: 9_177_000_001n,
      fullName: 'synthetic-org/synthetic-repository',
      visibility: 'PRIVATE',
      archived: false,
    },
  });
}

async function createActivityEvent(
  id: string = EVENT_ID,
  deliveryId: string = `${TEST_PREFIX}delivery`,
  dedupeKey: string = `${TEST_PREFIX}dedupe`,
): Promise<void> {
  await prisma.orgRepositoryActivityEvent.create({
    data: {
      id,
      inventoryId: INVENTORY_ID,
      deliveryId,
      eventType: 'synthetic-event',
      occurredAt: new Date('2026-07-21T00:00:00Z'),
      dedupeKey,
      commitDelta: 2,
      pullRequestDelta: 1,
      starDelta: 3,
    },
  });
}

describe('Org repository inventory integration', () => {
  beforeAll(async () => {
    await prisma.$connect();
  }, DATABASE_CONNECTION_TIMEOUT_MS);

  beforeEach(async () => {
    await cleanFixtures();
    await createInventory();
  });

  afterEach(cleanFixtures);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it.each([
    {
      name: '같은 deliveryId',
      id: `${TEST_PREFIX}event:duplicate-delivery`,
      deliveryId: `${TEST_PREFIX}delivery`,
      dedupeKey: `${TEST_PREFIX}dedupe:other`,
    },
    {
      name: '같은 dedupeKey',
      id: `${TEST_PREFIX}event:duplicate-dedupe`,
      deliveryId: `${TEST_PREFIX}delivery:other`,
      dedupeKey: `${TEST_PREFIX}dedupe`,
    },
  ])('$name 활동 이벤트는 중복 저장할 수 없다', async (duplicate) => {
    // Given
    await createActivityEvent();

    // When
    const duplicateInsert = createActivityEvent(
      duplicate.id,
      duplicate.deliveryId,
      duplicate.dedupeKey,
    );

    // Then
    await expect(duplicateInsert).rejects.toMatchObject({ code: 'P2002' });
  });

  it('visibility 변경 뒤에도 저장소 identity와 활동 metric을 유지한다', async () => {
    // Given
    await createActivityEvent();

    // When
    const updatedInventory = await prisma.orgRepositoryInventory.update({
      where: { githubRepositoryId: 9_177_000_001n },
      data: { visibility: 'PUBLIC' },
    });

    // Then
    const activityEvent =
      await prisma.orgRepositoryActivityEvent.findUniqueOrThrow({
        where: { id: EVENT_ID },
      });
    expect(updatedInventory.id).toBe(INVENTORY_ID);
    expect(activityEvent).toMatchObject({
      commitDelta: 2,
      pullRequestDelta: 1,
      starDelta: 3,
    });
  });

  it('회원 계정 삭제가 Org 저장소와 활동 이력을 삭제하지 않는다', async () => {
    // Given
    await createActivityEvent();
    await prisma.user.create({
      data: {
        id: USER_ID,
        githubId: 9_177_000_002n,
        nickname: 'synthetic-177-user',
      },
    });

    // When
    await prisma.user.delete({ where: { id: USER_ID } });

    // Then
    const [inventory, activityEvent] = await Promise.all([
      prisma.orgRepositoryInventory.findUniqueOrThrow({
        where: { id: INVENTORY_ID },
      }),
      prisma.orgRepositoryActivityEvent.findUniqueOrThrow({
        where: { id: EVENT_ID },
      }),
    ]);
    expect(inventory.id).toBe(INVENTORY_ID);
    expect(activityEvent.id).toBe(EVENT_ID);
  });
});
