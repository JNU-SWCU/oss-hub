import { randomUUID } from 'node:crypto';
import {
  MilestoneSubmissionType,
  ProgramAuthoringUploadLifecycle,
  ProgramCategory,
  ProgramLifecycle,
} from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { e2eProgramAuthoringExternalPorts } from './e2e-external-ports';
import {
  E2E_NOW,
  E2E_PROGRAM_ID,
  E2E_STAFF_ID,
  E2eProgramAuthoringFixture,
} from './e2e-program-authoring-fixture';
import { PrismaService } from '../prisma/prisma.service';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
const fixture = new E2eProgramAuthoringFixture(prisma);

// adapter의 exercisePrismaFailure가 재시도 성공 때 authoring.create로 만드는 프로그램과 같은
// 모양이다 — fixture 프로그램 바깥에 있고, 첨부된 양식 업로드 하나를 자기 서류 항목에 건다.
const AGGREGATE_PROGRAM_ID = `${E2E_PROGRAM_ID}:aggregate`;
const AGGREGATE_MILESTONE_ID = `${AGGREGATE_PROGRAM_ID}-milestone`;
const AGGREGATE_DOCUMENT_ID = `${AGGREGATE_PROGRAM_ID}-document`;
const AGGREGATE_IDEMPOTENCY_KEY = 'e2e-state-scope'; // gitleaks:allow — 결정론적 테스트 상수
const ONE_HOUR_MS = 60 * 60 * 1000;
const AGGREGATE_APPLICATION_START_AT = new Date(
  E2E_NOW.getTime() - 24 * ONE_HOUR_MS,
);
const AGGREGATE_MILESTONE_DUE_AT = new Date(
  E2E_NOW.getTime() + 9 * ONE_HOUR_MS,
);
const AGGREGATE_END_AT = new Date(E2E_NOW.getTime() + 240 * ONE_HOUR_MS);

beforeAll(async () => {
  await prisma.$connect();
});

afterEach(async () => {
  await removeAggregateProgram();
  await fixture.reset();
  e2eProgramAuthoringExternalPorts.reset();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('stateForE2eProgramGraph orphan accounting', () => {
  it('프로그램 밖 aggregate에 첨부된 업로드를 고아로 세지 않는다', async () => {
    // Given
    await fixture.reset();
    await fixture.ensure();
    const storageKey = await storeAggregateObject();
    await seedAggregateProgram(storageKey);

    // When
    const state = await fixture.state(
      e2eProgramAuthoringExternalPorts.capture(),
    );

    // Then
    expect(state).toMatchObject({
      programs: 1,
      attachedFiles: 1,
      orphanObjects: 0,
    });
  });

  it('aggregate 업로드의 스토리지 객체가 사라지면 고아로 센다', async () => {
    // Given
    await fixture.reset();
    await fixture.ensure();
    await seedAggregateProgram(`program-authoring/${randomUUID()}`);

    // When
    const state = await fixture.state(
      e2eProgramAuthoringExternalPorts.capture(),
    );

    // Then
    expect(state).toMatchObject({ attachedFiles: 1, orphanObjects: 1 });
  });

  it('어느 행도 소유하지 않는 스토리지 객체를 고아로 센다', async () => {
    // Given
    await fixture.reset();
    await fixture.ensure();
    await storeAggregateObject();

    // When
    const state = await fixture.state(
      e2eProgramAuthoringExternalPorts.capture(),
    );

    // Then
    expect(state).toMatchObject({ attachedFiles: 0, orphanObjects: 1 });
  });
});

async function storeAggregateObject(): Promise<string> {
  const stored = await e2eProgramAuthoringExternalPorts.storage.put({
    objectKey: `program-authoring/${randomUUID()}`,
    body: Buffer.from('%PDF-1.4\naggregate.pdf\n'),
    originalName: 'aggregate.pdf',
    contentType: 'application/pdf',
  });
  return stored.objectKey;
}

async function seedAggregateProgram(storageKey: string): Promise<void> {
  await prisma.program.create({
    data: {
      id: AGGREGATE_PROGRAM_ID,
      name: `${E2E_PROGRAM_ID}:aggregate`,
      organizer: `${E2E_PROGRAM_ID}:organizer`,
      category: ProgramCategory.BASIC,
      lifecycle: ProgramLifecycle.PUBLISHED,
      applicationTemplateKey: 'basic',
      applicationTemplateVersion: 1,
      applicationStartAt: AGGREGATE_APPLICATION_START_AT,
      applicationEndAt: E2E_NOW,
      startAt: E2E_NOW,
      endAt: AGGREGATE_END_AT,
      description: `${E2E_PROGRAM_ID}:aggregate`,
      milestones: {
        create: {
          id: AGGREGATE_MILESTONE_ID,
          name: `${E2E_PROGRAM_ID}:aggregate-milestone`,
          startAt: E2E_NOW,
          dueAt: AGGREGATE_MILESTONE_DUE_AT,
          submissionType: MilestoneSubmissionType.FILE,
          documents: {
            create: {
              id: AGGREGATE_DOCUMENT_ID,
              name: `${E2E_PROGRAM_ID}:aggregate-document`,
              required: true,
              sortOrder: 0,
              templateFile: {
                create: {
                  storageKey,
                  originalFileName: 'aggregate.pdf',
                  mimeType: 'application/pdf',
                  sizeBytes: 1,
                  uploadedById: E2E_STAFF_ID,
                },
              },
            },
          },
        },
      },
    },
  });
  const request = await prisma.programCreateRequest.create({
    data: {
      actorId: E2E_STAFF_ID,
      idempotencyKey: AGGREGATE_IDEMPOTENCY_KEY,
      payloadHash: 'a'.repeat(64),
      programId: AGGREGATE_PROGRAM_ID,
    },
    select: { id: true },
  });
  await prisma.programAuthoringUpload.create({
    data: {
      actorId: E2E_STAFF_ID,
      storageKey,
      originalFileName: 'aggregate.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1,
      sha256: 'a'.repeat(64),
      lifecycle: ProgramAuthoringUploadLifecycle.ATTACHED,
      expiresAt: E2E_NOW,
      attachedAt: E2E_NOW,
      createRequestActorId: E2E_STAFF_ID,
      createRequestId: request.id,
    },
  });
}

// fixture.reset()은 fixture 프로그램만 되돌린다 — 이 스펙이 만든 aggregate 그래프는
// adapter의 removePrismaAggregate와 같은 자식→부모 순서로 직접 지운다.
async function removeAggregateProgram(): Promise<void> {
  await prisma.milestoneDocumentTemplateFile.deleteMany({
    where: {
      milestoneDocument: { milestone: { programId: AGGREGATE_PROGRAM_ID } },
    },
  });
  await prisma.programAuthoringUpload.deleteMany({
    where: { createRequest: { programId: AGGREGATE_PROGRAM_ID } },
  });
  await prisma.programCreateRequest.deleteMany({
    where: { programId: AGGREGATE_PROGRAM_ID },
  });
  await prisma.milestoneDocument.deleteMany({
    where: { milestone: { programId: AGGREGATE_PROGRAM_ID } },
  });
  await prisma.milestone.deleteMany({
    where: { programId: AGGREGATE_PROGRAM_ID },
  });
  await prisma.program.deleteMany({ where: { id: AGGREGATE_PROGRAM_ID } });
}
