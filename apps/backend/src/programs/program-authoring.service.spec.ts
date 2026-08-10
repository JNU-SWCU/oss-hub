import {
  AccountStatus,
  MilestoneSubmissionType,
  ProgramAuthoringUploadLifecycle,
  ProgramCategory,
  ProgramLifecycle,
  Role,
} from '@prisma/client';
import { Test } from '@nestjs/testing';
import { ProgramAuthoringRepository } from './program-authoring.repository';
import { ProgramAuthoringService } from './program-authoring.service';
import type {
  ProgramAuthoringProgram,
  ProgramAuthoringRequest,
  ProgramAuthoringTransactionStore,
} from './program-authoring.types';

const ACTOR_ID = 'actor-id';
const GITHUB_ID = 7n;

function request(templateUploadId?: string): ProgramAuthoringRequest {
  return {
    name: 'Program',
    organizer: 'OSS Center',
    category: ProgramCategory.CAPSTONE,
    applicationStartAt: '2026-08-01T00:00:00.000Z',
    applicationEndAt: '2026-08-05T00:00:00.000Z',
    startAt: '2026-08-06T00:00:00.000Z',
    endAt: '2026-09-01T00:00:00.000Z',
    teamMinSize: 1,
    teamMaxSize: 4,
    description: 'Description',
    milestones: [
      {
        name: 'Milestone',
        dueAt: '2026-08-20T00:00:00.000Z',
        submissionType: MilestoneSubmissionType.FILE,
        documents: [
          {
            name: 'Template',
            required: true,
            submissionType: MilestoneSubmissionType.FILE,
            ...(templateUploadId === undefined ? {} : { templateUploadId }),
          },
        ],
      },
    ],
  };
}

function program(): ProgramAuthoringProgram {
  return {
    id: 'program-id',
    name: 'Program',
    organizer: 'OSS Center',
    category: ProgramCategory.CAPSTONE,
    lifecycle: ProgramLifecycle.PUBLISHED,
    applicationTemplateKey: 'CAPSTONE',
    applicationTemplateVersion: 1,
    applicationStartAt: new Date('2026-08-01T00:00:00.000Z'),
    applicationEndAt: new Date('2026-08-05T00:00:00.000Z'),
    startAt: new Date('2026-08-06T00:00:00.000Z'),
    endAt: new Date('2026-09-01T00:00:00.000Z'),
    teamMinSize: 1,
    teamMaxSize: 4,
    description: 'Description',
    repositoryProvisioningEnabled: false,
    notifyOnDeadline: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function setup() {
  const transaction: jest.Mocked<ProgramAuthoringTransactionStore> = {
    createProgram: jest.fn().mockResolvedValue(program()),
    createRequest: jest.fn().mockResolvedValue('request-id'),
    lockUploads: jest.fn().mockResolvedValue([]),
    createMilestone: jest.fn().mockResolvedValue('milestone-id'),
    createDocument: jest.fn().mockResolvedValue('document-id'),
    createTemplate: jest.fn().mockResolvedValue(undefined),
    attachUploads: jest.fn().mockResolvedValue(undefined),
  };
  const repository = {
    findActor: jest.fn().mockResolvedValue({
      id: ACTOR_ID,
      accountStatus: AccountStatus.ACTIVE,
      role: Role.STAFF,
    }),
    findReplay: jest.fn().mockResolvedValue(null),
    withTransaction: <T>(
      operation: (store: ProgramAuthoringTransactionStore) => Promise<T>,
    ) => operation(transaction),
  } satisfies Pick<
    ProgramAuthoringRepository,
    'findActor' | 'findReplay' | 'withTransaction'
  >;
  return {
    repository,
    transaction,
    service: new ProgramAuthoringService(repository),
  };
}

describe('ProgramAuthoringService', () => {
  it('resolves the narrowed store through the concrete repository provider', async () => {
    // Given
    const { repository } = setup();
    const moduleRef = await Test.createTestingModule({
      providers: [
        ProgramAuthoringService,
        { provide: ProgramAuthoringRepository, useValue: repository },
      ],
    }).compile();

    // When
    const service = moduleRef.get(ProgramAuthoringService);

    // Then
    expect(
      Reflect.getMetadata('self:paramtypes', ProgramAuthoringService),
    ).toEqual([{ index: 0, param: ProgramAuthoringRepository }]);
    expect(service).toBeInstanceOf(ProgramAuthoringService);
    await moduleRef.close();
  });

  it('creates ordered children and atomically attaches an owned pending template', async () => {
    // Given
    const { transaction, service } = setup();
    transaction.lockUploads.mockResolvedValueOnce([
      {
        id: 'upload-id',
        actorId: ACTOR_ID,
        lifecycle: ProgramAuthoringUploadLifecycle.PENDING,
        unexpired: true,
        storageKey: 'program-authoring/server-uuid',
        originalFileName: 'template.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 64,
      },
    ]);

    // When
    const result = await service.create(GITHUB_ID, 'key', request('upload-id'));

    // Then
    expect(result.id).toBe('program-id');
    expect(transaction.createTemplate.mock.calls).toEqual([
      [
        expect.objectContaining({
          milestoneDocumentId: 'document-id',
          actorId: ACTOR_ID,
        }),
      ],
    ]);
    expect(transaction.attachUploads.mock.calls).toEqual([
      [ACTOR_ID, 'request-id', ['upload-id']],
    ]);
  });

  it('rejects a foreign token before creating program rows', async () => {
    // Given
    const { transaction, service } = setup();
    transaction.lockUploads.mockResolvedValueOnce([
      {
        id: 'upload-id',
        actorId: 'other-actor',
        lifecycle: ProgramAuthoringUploadLifecycle.PENDING,
        unexpired: true,
        storageKey: 'program-authoring/server-uuid',
        originalFileName: 'template.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 64,
      },
    ]);

    // When / Then
    await expect(
      service.create(GITHUB_ID, 'key', request('upload-id')),
    ).rejects.toMatchObject({ reason: 'NOT_OWNED' });
    expect(transaction.createProgram.mock.calls).toEqual([]);
  });
});
