import {
  AccountStatus,
  ProgramAuthoringUploadLifecycle,
  ProgramCategory,
  ProgramLifecycle,
  ProgramTrackType,
} from '@prisma/client';
import {
  ProgramNoticePreviewService,
  ProgramAuthoringService,
  buildProgramAuthoringPlan,
  canonicalProgramAuthoringPayload,
  hashProgramAuthoringPayload,
} from './program-authoring.service';
import { createHash } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { AuditLogService } from '../platform/audit-log.service';
import {
  ProgramAuthoringRepository,
  type ProgramAuthoringTransactionStore,
} from './program-authoring.repository';
import { PROGRAM_CREATED_AUDIT_ACTIONS } from '../platform/audit-log.repository';
import {
  ProgramAuthoringIdempotencyRaceError,
  ProgramAuthoringIdempotencyConflictError,
} from './program-authoring.error';
import {
  type ProgramAuthoringProgram,
  type ProgramAuthoringRequest,
} from './program-authoring-upload-transaction.repository';

describe('program-notice-preview.service', () => {
  const source = 'https://sojoong.kr/notice/notice-board/?uid=123&mod=document';
  const html =
    '<div class="kboard-title"><h1>Synthetic</h1></div><div class="kboard-content"><div class="content-view"><p>First</p><p>Second</p></div></div>';
  const actor = {
    id: 'staff-synthetic',
    accountStatus: AccountStatus.ACTIVE,
    hasStaffAccess: true,
    hasAdminAccess: false,
  };
  function setup() {
    const findActor = jest.fn(() => Promise.resolve(actor));
    const read = jest.fn(() => Promise.resolve(html));
    return {
      service: new ProgramNoticePreviewService({ findActor }, { read }),
      findActor,
      read,
    };
  }

  it('returns clean editable candidates for an active staff member without persistence', async () => {
    const { service } = setup();
    expect(await service.preview(1n, source)).toEqual({
      sourceUrl: source,
      name: 'Synthetic',
      description: 'First\nSecond',
      coverImages: [],
      warnings: ['NO_IMAGE'],
    });
  });

  it.each([
    { ...actor, hasStaffAccess: false },
    { ...actor, accountStatus: AccountStatus.DEACTIVATED },
  ])('rejects an unauthorized actor before fetching: %j', async (value) => {
    const read = jest.fn(() => Promise.resolve(html));
    const service = new ProgramNoticePreviewService(
      { findActor: () => Promise.resolve(value) },
      { read },
    );
    await expect(service.preview(1n, source)).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
  });

  it('rejects a missing actor before fetching', async () => {
    const read = jest.fn(() => Promise.resolve(html));
    const service = new ProgramNoticePreviewService(
      { findActor: () => Promise.resolve(null) },
      { read },
    );
    await expect(service.preview(1n, source)).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
  });

  it('limits one actor to six requests in a rolling minute', async () => {
    const { service, read } = setup();
    for (let index = 0; index < 6; index++) await service.preview(1n, source);
    await expect(service.preview(1n, source)).rejects.toMatchObject({
      errorCode: { status: 429 },
    });
    expect(read).toHaveBeenCalledTimes(6);
  });

  it('limits concurrent upstream fetches to four and releases slots after completion', async () => {
    let finish: (html: string) => void = () => {
      throw new Error('not started');
    };
    const pending = new Promise<string>((resolve) => {
      finish = resolve;
    });
    const read = jest.fn(() => pending);
    const service = new ProgramNoticePreviewService(
      { findActor: () => Promise.resolve(actor) },
      { read },
    );
    const requests = [1, 2, 3, 4].map(() => service.preview(1n, source));
    await expect(service.preview(1n, source)).rejects.toMatchObject({
      errorCode: { status: 429 },
    });
    finish(html);
    await Promise.all(requests);
    await expect(service.preview(1n, source)).resolves.toMatchObject({
      name: 'Synthetic',
    });
  });

  it('limits all actors combined to sixty requests per rolling minute', async () => {
    const read = jest.fn(() => Promise.resolve(html));
    const service = new ProgramNoticePreviewService(
      { findActor: (id) => Promise.resolve({ ...actor, id: `staff-${id}` }) },
      { read },
    );
    for (let index = 0; index < 60; index++)
      await service.preview(BigInt(index), source);
    await expect(service.preview(61n, source)).rejects.toMatchObject({
      errorCode: { status: 429 },
    });
  });
});

const ACTOR_ID = 'actor-id';
const GITHUB_ID = 7n;

function request(templateUploadId?: string): ProgramAuthoringRequest {
  return {
    name: 'Program',
    organizer: 'OSS Center',
    trackType: ProgramTrackType.CURRICULAR,
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
        documents:
          templateUploadId === undefined
            ? []
            : [
                {
                  name: 'Template',
                  required: true,
                  templateUploadId,
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
    category: ProgramCategory.BASIC,
    trackType: ProgramTrackType.CURRICULAR,
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
  it('rejects a changed track on a retry instead of returning the first program', async () => {
    const { service, repository, transaction } = setup();
    repository.findReplay.mockResolvedValue({
      payloadHash: hashProgramAuthoringPayload(
        buildProgramAuthoringPlan(request()),
      ),
      program: program(),
    });

    await expect(
      service.create(GITHUB_ID, 'key', {
        ...request(),
        trackType: ProgramTrackType.EXTRACURRICULAR,
      }),
    ).rejects.toMatchObject({
      name: 'ProgramAuthoringIdempotencyConflictError',
      existingProgramId: 'program-id',
    });
    expect(transaction.createProgram.mock.calls).toHaveLength(0);
  });

  it('requires existing-program confirmation when a historical hash has no track proof', async () => {
    const { service, repository, transaction } = setup();
    const canonical = canonicalProgramAuthoringPayload(
      buildProgramAuthoringPlan(request()),
    );
    const { trackType, ...historicalProgram } = canonical.program;
    const historicalHash = createHash('sha256')
      .update(
        JSON.stringify({
          ...canonical,
          schemaVersion: 1,
          program: historicalProgram,
        }),
      )
      .digest('hex');
    repository.findReplay.mockResolvedValue({
      payloadHash: historicalHash,
      program: { ...program(), trackType },
    });

    await expect(service.create(GITHUB_ID, 'key', request())).rejects.toEqual(
      new ProgramAuthoringIdempotencyConflictError(
        ACTOR_ID,
        'key',
        'program-id',
      ),
    );
    expect(transaction.createProgram.mock.calls).toHaveLength(0);
  });

  it.each([
    null,
    {
      id: ACTOR_ID,
      accountStatus: AccountStatus.DEACTIVATED,
      hasStaffAccess: true,
      hasAdminAccess: true,
    },
    {
      id: ACTOR_ID,
      accountStatus: AccountStatus.ACTIVE,
      hasStaffAccess: false,
      hasAdminAccess: false,
    },
  ])(
    'rejects an unavailable upload author before starting writes',
    async (actor) => {
      const { repository, transaction, service } = setup();
      repository.findActor.mockResolvedValueOnce(actor);

      await expect(service.requireAuthor(GITHUB_ID)).rejects.toMatchObject({
        name: 'ProgramAuthoringForbiddenError',
      });
      expect(repository.findActor).toHaveBeenCalledWith(GITHUB_ID);
      expect(transaction.createProgram.mock.calls).toEqual([]);
      expect(repository.findReplay).not.toHaveBeenCalled();
    },
  );

  it('resolves the narrowed store through the concrete repository provider', async () => {
    const { repository } = setup();
    const moduleRef = await Test.createTestingModule({
      providers: [
        ProgramAuthoringService,
        { provide: ProgramAuthoringRepository, useValue: repository },
        { provide: AuditLogService, useValue: { record: jest.fn() } },
      ],
    }).compile();

    const service = moduleRef.get(ProgramAuthoringService);

    expect(
      Reflect.getMetadata('self:paramtypes', ProgramAuthoringService),
    ).toEqual([{ index: 0, param: ProgramAuthoringRepository }]);
    expect(service).toBeInstanceOf(ProgramAuthoringService);
    await moduleRef.close();
  });

  it('creates ordered children and atomically attaches an owned pending template', async () => {
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

    const result = await service.create(GITHUB_ID, 'key', request('upload-id'));

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
