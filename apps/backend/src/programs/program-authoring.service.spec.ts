import {
  AccountStatus,
  MilestoneSubmissionType,
  ProgramAuthoringUploadLifecycle,
  ProgramCategory,
  ProgramLifecycle,
} from '@prisma/client';
import { Test } from '@nestjs/testing';
import { AuditLogService } from '../audit-log/audit-log.service';
import { PROGRAM_CREATED_AUDIT_ACTIONS } from '../audit-log/audit-log-metadata';
import { buildProgramAuthoringPlan } from './program-authoring-plan';
import { hashProgramAuthoringPayload } from './program-authoring-payload-hash';
import { ProgramAuthoringRepository } from './program-authoring.repository';
import { ProgramAuthoringService } from './program-authoring.service';
import {
  ProgramAuthoringIdempotencyRaceError,
  type ProgramAuthoringProgram,
  type ProgramAuthoringRequest,
  type ProgramAuthoringTransactionStore,
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
  const auditLogWriter =
    {} as ProgramAuthoringTransactionStore['auditLogWriter'];
  const record = jest.fn().mockResolvedValue(undefined);
  const auditLog = { record } as unknown as AuditLogService;
  const transaction: jest.Mocked<ProgramAuthoringTransactionStore> = {
    auditLogWriter,
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
      hasStaffAccess: true,
      hasAdminAccess: false,
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
    record,
    service: new ProgramAuthoringService(repository, auditLog),
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
        { provide: AuditLogService, useValue: { record: jest.fn() } },
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

  it('records PROGRAM_CREATED once inside the success transaction', async () => {
    const { service, record, transaction } = setup();

    await service.create(GITHUB_ID, 'key', request());

    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorGithubId: GITHUB_ID,
        action: PROGRAM_CREATED_AUDIT_ACTIONS.PROGRAM_CREATED,
        targetType: 'PROGRAM',
        targetId: 'program-id',
        metadata: {
          schemaVersion: 1,
          programName: 'Program',
        },
      }),
      transaction.auditLogWriter,
    );
  });

  it('does not record on idempotent replay', async () => {
    const { service, repository, record } = setup();
    const created = program();
    repository.findReplay.mockResolvedValue({
      payloadHash: hashProgramAuthoringPayload(
        buildProgramAuthoringPlan(request()),
      ),
      program: created,
    });

    await service.create(GITHUB_ID, 'key', request());

    expect(record).not.toHaveBeenCalled();
  });

  it('does not record when the idempotency race replays', async () => {
    const { service, repository, record, transaction } = setup();
    transaction.createRequest.mockRejectedValue(
      new ProgramAuthoringIdempotencyRaceError(new Error('p2002')),
    );
    repository.findReplay.mockResolvedValueOnce(null).mockResolvedValueOnce({
      payloadHash: hashProgramAuthoringPayload(
        buildProgramAuthoringPlan(request()),
      ),
      program: program(),
    });

    await service.create(GITHUB_ID, 'key', request());

    expect(record).not.toHaveBeenCalled();
  });
});
