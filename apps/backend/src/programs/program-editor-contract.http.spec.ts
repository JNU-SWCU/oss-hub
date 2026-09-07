import { ExecutionContext, ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { AccountStatus } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { OriginGuard } from '../auth/origin.guard';
import { SessionGuard } from '../auth/session.guard';
import { ProblemDetailFilter } from '../common/problem-detail.filter';
import { ProgramEditorController } from './controller/program-editor.controller';
import { MilestonesController } from './controller/milestones.controller';
import { ProgramEditorRepository } from './repository/program-editor.repository';
import { ProgramEditorService } from './service/program-editor.service';
import { ProgramLifecycleService } from './service/program-lifecycle.service';
import type {
  ProgramEditorRepositoryPort,
  ProgramEditorTransactionStore,
} from './service/program-editor.service';
import {
  editableProgram,
  updateInput,
} from '../../test/program-editor-service-fixtures';
import { ProgramAuthoringUploadTokenError } from './program-authoring.types';

let application: INestApplication | undefined;
let baseUrl = '';

const store: jest.Mocked<ProgramEditorTransactionStore> = {
  findUserAuthorityByGithubId: jest.fn(),
  findEditableProgramById: jest.fn(),
  findEditableProgramForUpdate: jest.fn(),
  updateProgram: jest.fn(),
  findProgramScheduleForMilestoneCreate: jest.fn(),
  createMilestone: jest.fn(),
  findMilestoneForUpdate: jest.fn(),
  updateMilestone: jest.fn(),

  findMilestoneForDelete: jest.fn(),
  deleteMilestone: jest.fn(),
  lockMilestoneEdit: jest.fn(),
  countSubmissionHistoriesForDocuments: jest.fn(),
  lockAttachableUploads: jest.fn(),
  applyMilestoneEdit: jest.fn(),
};

const repository: ProgramEditorRepositoryPort = {
  withTransaction: (operation) => operation(store),
};

function sessionGuard(context: ExecutionContext): boolean {
  const request = context
    .switchToHttp()
    .getRequest<{ sessionGithubId: bigint }>();
  request.sessionGithubId = 101n;
  return true;
}

async function readJson(response: Response): Promise<unknown> {
  return JSON.parse(await response.text());
}

async function patchProgram(body: object): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/programs/program-1`, {
    method: 'PATCH',
    headers: { connection: 'close', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function patchMilestone(body: object): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/milestones/milestone-1`, {
    method: 'PATCH',
    headers: { connection: 'close', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function getMilestoneEdit(): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/milestones/milestone-1/edit`, {
    headers: { connection: 'close' },
  });
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [ProgramEditorController, MilestonesController],
    providers: [
      ProgramEditorService,
      { provide: ProgramEditorRepository, useValue: repository },
      { provide: ProgramLifecycleService, useValue: { update: jest.fn() } },
    ],
  })
    .overrideGuard(SessionGuard)
    .useValue({ canActivate: sessionGuard })
    .overrideGuard(OriginGuard)
    .useValue({ canActivate: () => true })
    .compile();

  application = moduleRef.createNestApplication();
  application.setGlobalPrefix('api/v1');
  application.useGlobalPipes(
    new ValidationPipe({ transform: true, whitelist: true }),
  );
  application.useGlobalFilters(new ProblemDetailFilter());
  await application.listen(0, '127.0.0.1');
  baseUrl = await application.getUrl();
});

beforeEach(() => {
  jest.clearAllMocks();
  const milestone = editableProgram.milestones[0];
  if (milestone === undefined) {
    throw new Error('Expected editable program milestone fixture.');
  }
  store.findUserAuthorityByGithubId.mockResolvedValue({
    id: 'staff-1',
    hasAdminAccess: false,
    hasStaffAccess: true,
    accountStatus: AccountStatus.ACTIVE,
    staffAccessRequests: [],
  });
  store.findEditableProgramForUpdate.mockResolvedValue(editableProgram);
  store.lockMilestoneEdit.mockResolvedValue({
    programId: 'program-1',
    milestoneUpdatedAt: new Date('2026-08-16T00:00:00.000Z'),
    view: {
      milestone,
      operation: {
        startAt: editableProgram.startAt,
        endAt: new Date(editableProgram.endAt),
      },
      documents: [],
    },
    fingerprintDocuments: [],
  });
  store.countSubmissionHistoriesForDocuments.mockResolvedValue(0);
  store.lockAttachableUploads.mockResolvedValue([]);
  store.findMilestoneForUpdate.mockResolvedValue({
    id: 'milestone-1',
    programId: 'program-1',
    programStartAt: new Date('2026-08-16T00:00:00.000Z'),
    endAt: new Date('2026-08-31T00:00:00.000Z'),
    name: 'Milestone',
    startAt: new Date('2026-08-16T00:00:00.000Z'),
    dueAt: new Date('2026-08-20T00:00:00.000Z'),
    submissionType: null,
    instructions: null,
  });
  store.updateMilestone.mockResolvedValue({
    id: 'milestone-1',
    name: 'Legacy milestone',
    startAt: new Date('2026-08-16T00:00:00.000Z'),
    dueAt: new Date('2026-08-20T00:00:00.000Z'),
    submissionType: null,
    instructions: null,
  });
});

afterAll(async () => {
  await application?.close();
});

it('returns field errors for an invalid application period through the API ProblemDetail contract', async () => {
  const response = await patchProgram({
    ...updateInput,
    applicationEndAt: '2026-07-31T00:00:00.000Z',
  });

  expect(response.status).toBe(422);
  expect(response.headers.get('content-type')).toContain(
    'application/problem+json',
  );
  expect(await readJson(response)).toMatchObject({
    type: 'about:blank',
    status: 422,
    instance: '/api/v1/programs/program-1',
    code: 'PRG_007',
    fieldErrors: [
      { field: 'applicationStartAt', code: 'INVALID_APPLICATION_PERIOD' },
      { field: 'applicationEndAt', code: 'INVALID_APPLICATION_PERIOD' },
    ],
  });
  expect(store.updateProgram.mock.calls).toHaveLength(0);
});

it('returns field errors for an invalid team range through the API ProblemDetail contract', async () => {
  const response = await patchProgram({
    ...updateInput,
    teamMinSize: 4,
    teamMaxSize: 2,
  });

  expect(response.status).toBe(400);
  expect(await readJson(response)).toMatchObject({
    status: 400,
    instance: '/api/v1/programs/program-1',
    code: 'PRG_001',
    fieldErrors: [
      { field: 'teamMinSize', code: 'INVALID_TEAM_RANGE' },
      { field: 'teamMaxSize', code: 'INVALID_TEAM_RANGE' },
    ],
  });
  expect(store.updateProgram.mock.calls).toHaveLength(0);
});

it('accepts the legacy partial metadata body without selecting aggregate validation', async () => {
  const response = await patchMilestone({
    name: 'Updated milestone',
    dueAt: '2026-08-20T00:00:00.000Z',
  });

  expect(response.status).toBe(200);
  expect(store.findMilestoneForUpdate.mock.calls).toHaveLength(1);
  expect(store.updateMilestone.mock.calls).toHaveLength(1);
  expect(store.lockMilestoneEdit.mock.calls).toHaveLength(0);
  expect(store.applyMilestoneEdit.mock.calls).toHaveLength(0);
});

it('EXPAND exception: legacy metadata PATCH omits concurrency checking for old clients only', async () => {
  const response = await patchMilestone({
    name: ' Legacy milestone ',
    startAt: '2026-08-16T00:00:00.000Z',
    dueAt: '2026-08-20T00:00:00.000Z',
    instructions: ' legacy instructions ',
  });

  expect(response.status).toBe(200);
  expect(store.findMilestoneForUpdate.mock.calls).toHaveLength(1);
  expect(store.updateMilestone.mock.calls).toHaveLength(1);
  expect(store.lockMilestoneEdit.mock.calls).toHaveLength(0);
  expect(store.applyMilestoneEdit.mock.calls).toHaveLength(0);
});

it('rejects an aggregate body without a fingerprint before either write path', async () => {
  const response = await patchMilestone({
    name: 'Aggregate missing fingerprint',
    startAt: '2026-08-16T00:00:00.000Z',
    dueAt: '2026-08-20T00:00:00.000Z',
    instructions: null,
    documents: [],
  });

  expect(response.status).toBe(400);
  expect(store.findMilestoneForUpdate.mock.calls).toHaveLength(0);
  expect(store.updateMilestone.mock.calls).toHaveLength(0);
  expect(store.lockMilestoneEdit.mock.calls).toHaveLength(0);
  expect(store.lockAttachableUploads.mock.calls).toHaveLength(0);
  expect(store.applyMilestoneEdit.mock.calls).toHaveLength(0);
});

it('rejects 21 documents before entering the transaction store', async () => {
  const response = await patchMilestone({
    expectedFingerprint: 'a'.repeat(64),
    name: 'Updated milestone',
    startAt: '2026-08-16T00:00:00.000Z',
    dueAt: '2026-08-20T00:00:00.000Z',
    instructions: null,
    documents: Array.from({ length: 21 }, () => ({
      id: null,
      name: 'Document',
      required: true,
    })),
  });

  expect(response.status).toBe(400);
  expect(store.lockMilestoneEdit.mock.calls).toHaveLength(0);
  expect(store.applyMilestoneEdit.mock.calls).toHaveLength(0);
});

it('rejects malformed aggregate-shaped input without dispatching either path', async () => {
  const response = await patchMilestone({
    expectedFingerprint: 'a'.repeat(64),
    name: 'Malformed',
    startAt: '2026-08-16T00:00:00.000Z',
    dueAt: '2026-08-20T00:00:00.000Z',
    instructions: null,
  });

  expect(response.status).toBe(400);
  expect(store.findMilestoneForUpdate.mock.calls).toHaveLength(0);
  expect(store.updateMilestone.mock.calls).toHaveLength(0);
  expect(store.lockMilestoneEdit.mock.calls).toHaveLength(0);
  expect(store.applyMilestoneEdit.mock.calls).toHaveLength(0);
});

it('keeps stale supplied aggregate fingerprints on the conflict path', async () => {
  const response = await patchMilestone({
    expectedFingerprint: 'b'.repeat(64),
    name: 'Updated milestone',
    startAt: '2026-08-16T00:00:00.000Z',
    dueAt: '2026-08-20T00:00:00.000Z',
    instructions: null,
    documents: [],
  });

  expect(response.status).toBe(409);
  expect(store.findMilestoneForUpdate.mock.calls).toHaveLength(0);
  expect(store.applyMilestoneEdit.mock.calls).toHaveLength(0);
});

it('returns a generic 400 for an expired upload token without exposing its ID', async () => {
  const snapshot = requireMilestoneEditSnapshot(
    await readJson(await getMilestoneEdit()),
  );
  store.lockAttachableUploads.mockRejectedValue(
    new ProgramAuthoringUploadTokenError('EXPIRED', ['upload-sensitive']),
  );
  const response = await patchMilestone({
    expectedFingerprint: snapshot.fingerprint,
    name: snapshot.milestone.name,
    startAt: snapshot.operation.startAt,
    dueAt: snapshot.milestone.dueAt,
    instructions: null,
    documents: [
      {
        id: null,
        name: 'Document',
        required: true,
        templateUploadId: 'upload-sensitive',
      },
    ],
  });

  expect(response.status).toBe(400);
  const body = JSON.stringify(await readJson(response));
  expect(body).not.toContain('upload-sensitive');
  expect(body).not.toContain('EXPIRED');
  expect(store.applyMilestoneEdit.mock.calls).toHaveLength(0);
});

it('returns a staff edit snapshot and accepts its full PATCH shape', async () => {
  const snapshotResponse = await getMilestoneEdit();
  expect(snapshotResponse.status).toBe(200);
  const snapshot = requireMilestoneEditSnapshot(
    await readJson(snapshotResponse),
  );
  expect(snapshot.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  expect(snapshot.operation).toEqual({
    startAt: '2026-08-16T00:00:00.000Z',
    endAt: '2026-08-31T00:00:00.000Z',
  });

  const patchResponse = await patchMilestone({
    expectedFingerprint: snapshot.fingerprint,
    name: snapshot.milestone.name,
    startAt: snapshot.operation.startAt,
    dueAt: snapshot.milestone.dueAt,
    instructions: null,
    documents: [],
  });
  expect(patchResponse.status).toBe(200);
  expect(store.applyMilestoneEdit.mock.calls).toHaveLength(1);
});

function requireMilestoneEditSnapshot(value: unknown): {
  readonly fingerprint: string;
  readonly operation: { readonly startAt: string; readonly endAt: string };
  readonly milestone: { readonly name: string; readonly dueAt: string };
} {
  if (!isRecord(value)) {
    throw new TypeError('Expected milestone edit snapshot.');
  }
  const snapshot = value;
  const operation = snapshot['operation'];
  const milestone = snapshot['milestone'];
  if (
    typeof snapshot['fingerprint'] !== 'string' ||
    !isRecord(operation) ||
    !isRecord(milestone)
  ) {
    throw new TypeError('Expected milestone edit snapshot.');
  }
  const operationRecord = operation;
  const milestoneRecord = milestone;
  if (
    typeof operationRecord['startAt'] !== 'string' ||
    typeof operationRecord['endAt'] !== 'string' ||
    typeof milestoneRecord['name'] !== 'string' ||
    typeof milestoneRecord['dueAt'] !== 'string'
  ) {
    throw new TypeError('Expected milestone edit snapshot.');
  }
  return {
    fingerprint: snapshot['fingerprint'],
    operation: {
      startAt: operationRecord['startAt'],
      endAt: operationRecord['endAt'],
    },
    milestone: {
      name: milestoneRecord['name'],
      dueAt: milestoneRecord['dueAt'],
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
