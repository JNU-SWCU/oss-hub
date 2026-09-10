import {
  MemberKind,
  MilestoneDocumentKind,
  ProgramAuthoringUploadLifecycle,
  Prisma,
} from '@prisma/client';
import { Readable } from 'node:stream';
import type { UnwrapTuple } from '@prisma/client/runtime/library';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { ProgramErrorCode } from './program-error-code.enum';
import { ProgramEditorRepository } from './repository/program-editor.repository';
import { ProgramEditorService } from './service/program-editor.service';
import { MilestoneDocumentFilesService } from '../milestone-documents/milestone-document-files.service';
import { MilestoneDocumentsRepository } from '../milestone-documents/milestone-documents.repository';
import type { SubmissionFileStoragePort } from '../submissions/submission-file-storage.port';
import { SubmissionFilesRepository } from '../submissions/submission-files.repository';
import { ProgramAuthoringUploadRepository } from './program-authoring-upload.repository';
import {
  MilestoneDocumentMissingError,
  upsertMilestoneDocumentSubmission,
} from '../milestone-documents/milestone-document-submission.repository';
import { PrismaService } from '../prisma/prisma.service';
import type {
  ProgramEditorRepositoryPort,
  ProgramEditorTransactionStore,
} from './program-editor.types';
import {
  cleanup,
  createMilestone,
  createProgram,
  domainCode,
  editor,
  installSyntheticAggregateFaultTrigger,
  prisma,
  runTogether,
  STAFF_GITHUB_ID,
  TEST_PREFIX,
} from './program-editor.integration-fixtures';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const DATABASE_CONNECTION_TIMEOUT_MS = 60_000;
let studentSequence = 0;

describe('ProgramEditorService milestone aggregate integration', () => {
  beforeAll(async () => {
    await prisma.$connect();
  }, DATABASE_CONNECTION_TIMEOUT_MS);

  beforeEach(async () => {
    await resetGraph();
    await prisma.user.create({
      data: {
        id: `${TEST_PREFIX}staff`,
        githubId: STAFF_GITHUB_ID,
        nickname: 'aggregate-staff',
        selectedMemberKind: MemberKind.STAFF,
        hasStaffAccess: true,
        accountStatus: 'ACTIVE',
      },
    });
  });

  afterEach(resetGraph);

  afterAll(async () => {
    await resetGraph();
    await prisma.$disconnect();
  });

  it('atomically applies metadata, document create/update/delete, and request order', async () => {
    const { milestoneId, firstDocumentId, secondDocumentId } =
      await seedGraph();
    const snapshot = await editor.getMilestoneEdit(
      STAFF_GITHUB_ID,
      milestoneId,
    );

    const result = await editor.updateMilestoneEdit(
      STAFF_GITHUB_ID,
      milestoneId,
      {
        expectedFingerprint: snapshot.fingerprint,
        name: 'Updated milestone',
        startAt: '2026-08-16T00:00:00.000Z',
        dueAt: '2026-08-21T00:00:00.000Z',
        instructions: 'Updated instructions',
        documents: [
          {
            id: secondDocumentId,
            name: 'Second updated',
            required: false,
          },
          { id: null, name: 'New document', required: true },
        ],
      },
    );

    expect(result.milestone).toMatchObject({
      id: milestoneId,
      name: 'Updated milestone',
      instructions: 'Updated instructions',
    });
    expect(result.documents.map((document) => document.name)).toEqual([
      'Second updated',
      'New document',
    ]);
    expect(result.documents.map((document) => document.sortOrder)).toEqual([
      1, 2,
    ]);
    expect(
      await prisma.milestoneDocument.findUnique({
        where: { id: firstDocumentId },
        select: { id: true },
      }),
    ).toBeNull();
  });

  it('allows existing zero documents to remain empty but rejects deleting the last document', async () => {
    const { milestoneId } = await seedGraph({ documentCount: 0 });
    const empty = await editor.getMilestoneEdit(STAFF_GITHUB_ID, milestoneId);
    await expect(
      editor.updateMilestoneEdit(
        STAFF_GITHUB_ID,
        milestoneId,
        request(empty, []),
      ),
    ).resolves.toMatchObject({ documents: [] });

    const withDocument = await seedGraph();
    const snapshot = await editor.getMilestoneEdit(
      STAFF_GITHUB_ID,
      withDocument.milestoneId,
    );
    await expect(
      editor.updateMilestoneEdit(
        STAFF_GITHUB_ID,
        withDocument.milestoneId,
        request(snapshot, []),
      ),
    ).rejects.toMatchObject({ errorCode: { code: 'MSD_030' } });
  });

  it('allows one same-fingerprint save and rejects the stale concurrent save', async () => {
    const { milestoneId } = await seedGraph();
    const snapshot = await editor.getMilestoneEdit(
      STAFF_GITHUB_ID,
      milestoneId,
    );
    const [first, second] = await runTogether(
      () =>
        editor.updateMilestoneEdit(
          STAFF_GITHUB_ID,
          milestoneId,
          request(snapshot, snapshot.documents),
        ),
      () =>
        editor.updateMilestoneEdit(
          STAFF_GITHUB_ID,
          milestoneId,
          request(snapshot, snapshot.documents),
        ),
    );

    expect([first.status, second.status].sort()).toEqual([
      'fulfilled',
      'rejected',
    ]);
    const rejected = first.status === 'rejected' ? first : second;
    if (rejected.status === 'rejected') {
      expect(domainCode(rejected.reason)).toBe(
        ProgramErrorCode.MILESTONE_EDIT_CHANGED,
      );
    }
  });

  it('transfers a locked pending upload into a template and removes only its pending row', async () => {
    const { milestoneId, firstDocumentId } = await seedGraph();
    const uploadId = await createPendingUpload('template-transfer');
    const snapshot = await editor.getMilestoneEdit(
      STAFF_GITHUB_ID,
      milestoneId,
    );

    await editor.updateMilestoneEdit(
      STAFF_GITHUB_ID,
      milestoneId,
      request(snapshot, [
        {
          id: firstDocumentId,
          name: 'Document 1',
          required: true,
          templateUploadId: uploadId,
        },
        ...snapshot.documents.slice(1),
      ]),
    );

    expect(
      await prisma.programAuthoringUpload.findUnique({
        where: { id: uploadId },
        select: { id: true },
      }),
    ).toBeNull();
    expect(
      await prisma.milestoneDocumentTemplateFile.findUnique({
        where: { milestoneDocumentId: firstDocumentId },
        select: { storageKey: true },
      }),
    ).toEqual({ storageKey: `program-authoring/${uploadId}` });
  });

  it('rejects a snapshot made before direct same-row template key replacement', async () => {
    const { milestoneId, firstDocumentId, secondDocumentId } =
      await seedGraph();
    await prisma.milestoneDocumentTemplateFile.create({
      data: {
        milestoneDocumentId: firstDocumentId,
        storageKey: 'objects/original',
        originalFileName: 'form.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 12,
        uploadedById: `${TEST_PREFIX}staff`,
      },
    });
    const snapshot = await editor.getMilestoneEdit(
      STAFF_GITHUB_ID,
      milestoneId,
    );
    await new MilestoneDocumentFilesService(
      new MilestoneDocumentsRepository(prisma),
      memoryStorage(),
      new SubmissionFilesRepository(prisma),
    ).uploadTemplate(
      `${TEST_PREFIX}staff`,
      milestoneId,
      firstDocumentId,
      pdfUpload(),
    );

    await expect(
      editor.updateMilestoneEdit(
        STAFF_GITHUB_ID,
        milestoneId,
        request(snapshot, [
          {
            id: secondDocumentId,
            name: 'Document 2',
            required: true,
          },
        ]),
      ),
    ).rejects.toMatchObject({
      errorCode: { code: ProgramErrorCode.MILESTONE_EDIT_CHANGED },
    });
    expect(
      await prisma.milestoneDocument.findUnique({
        where: { id: firstDocumentId },
        select: { id: true },
      }),
    ).not.toBeNull();
  });

  it('preserves a legacy submission slot while replacing the editable DOCUMENT graph', async () => {
    const { milestoneId } = await seedGraph({ documentCount: 0 });
    const legacyId = `${TEST_PREFIX}legacy:${crypto.randomUUID()}`;
    await prisma.milestoneDocument.create({
      data: {
        id: legacyId,
        milestoneId,
        name: 'Legacy slot',
        required: true,
        sortOrder: -1,
        kind: MilestoneDocumentKind.LEGACY_MILESTONE_SUBMISSION,
      },
    });
    const snapshot = await editor.getMilestoneEdit(
      STAFF_GITHUB_ID,
      milestoneId,
    );
    await editor.updateMilestoneEdit(
      STAFF_GITHUB_ID,
      milestoneId,
      request(snapshot, [{ id: null, name: 'New document', required: true }]),
    );

    expect(
      await prisma.milestoneDocument.findUnique({
        where: { id: legacyId },
        select: { kind: true },
      }),
    ).toEqual({ kind: MilestoneDocumentKind.LEGACY_MILESTONE_SUBMISSION });
  });

  it('rejects expired and foreign pending upload tokens without changing the graph', async () => {
    const { milestoneId, firstDocumentId } = await seedGraph();
    const expired = await createPendingUpload(
      'expired',
      new Date('2020-01-01'),
    );
    const snapshot = await editor.getMilestoneEdit(
      STAFF_GITHUB_ID,
      milestoneId,
    );
    const original = await prisma.milestone.findUniqueOrThrow({
      where: { id: milestoneId },
      select: { name: true },
    });

    await expect(
      editor.updateMilestoneEdit(
        STAFF_GITHUB_ID,
        milestoneId,
        request(snapshot, [
          {
            id: firstDocumentId,
            name: 'Should not persist',
            required: true,
            templateUploadId: expired,
          },
          ...snapshot.documents.slice(1),
        ]),
      ),
    ).rejects.toMatchObject({
      errorCode: { code: ProgramErrorCode.VALIDATION_ERROR, status: 400 },
      extensions: {
        fieldErrors: [
          {
            field: 'documents[0].templateUploadId',
            code: 'INVALID_UPLOAD_TOKEN',
          },
        ],
      },
    });
    expect(
      await prisma.milestone.findUniqueOrThrow({
        where: { id: milestoneId },
        select: { name: true },
      }),
    ).toEqual(original);
  });

  it('returns DOCUMENT_NOT_FOUND after aggregate deletion and never recreates a template pointer', async () => {
    const { milestoneId, firstDocumentId, secondDocumentId } =
      await seedGraph();
    const snapshot = await editor.getMilestoneEdit(
      STAFF_GITHUB_ID,
      milestoneId,
    );
    await editor.updateMilestoneEdit(
      STAFF_GITHUB_ID,
      milestoneId,
      request(snapshot, [
        { id: secondDocumentId, name: 'Document 2', required: true },
      ]),
    );
    const files = new MilestoneDocumentFilesService(
      new MilestoneDocumentsRepository(prisma),
      memoryStorage(),
      new SubmissionFilesRepository(prisma),
    );

    await expect(
      files.uploadTemplate(
        `${TEST_PREFIX}staff`,
        milestoneId,
        firstDocumentId,
        pdfUpload(),
      ),
    ).rejects.toMatchObject({ errorCode: { code: 'MSD_004' } });
    expect(
      await prisma.milestoneDocumentTemplateFile.findUnique({
        where: { milestoneDocumentId: firstDocumentId },
        select: { id: true },
      }),
    ).toBeNull();
  });

  it('pauses direct template storage completion before its document lock while aggregate deletes, then rejects without pointer resurrection', async () => {
    const { milestoneId, firstDocumentId, secondDocumentId } =
      await seedGraph();
    const gate = deferred<void>();
    const files = new MilestoneDocumentFilesService(
      new MilestoneDocumentsRepository(prisma),
      {
        ...memoryStorage(),
        put: (input) =>
          gate.promise.then(() => ({
            objectKey: input.objectKey ?? `objects/${crypto.randomUUID()}`,
            originalName: input.originalName,
            contentLength: input.body.byteLength,
            contentType: input.contentType,
          })),
      },
      new SubmissionFilesRepository(prisma),
    );
    const direct = files.uploadTemplate(
      `${TEST_PREFIX}staff`,
      milestoneId,
      firstDocumentId,
      pdfUpload(),
    );
    const snapshot = await editor.getMilestoneEdit(
      STAFF_GITHUB_ID,
      milestoneId,
    );
    await editor.updateMilestoneEdit(
      STAFF_GITHUB_ID,
      milestoneId,
      request(snapshot, [
        { id: secondDocumentId, name: 'Document 2', required: true },
      ]),
    );
    gate.resolve();

    await expect(direct).rejects.toMatchObject({
      errorCode: { code: 'MSD_004' },
    });
    expect(
      await prisma.milestoneDocumentTemplateFile.findUnique({
        where: { milestoneDocumentId: firstDocumentId },
        select: { id: true },
      }),
    ).toBeNull();
  });

  it('serializes a real student submission lock before aggregate deletion and preserves its history', async () => {
    const { programId, milestoneId, firstDocumentId, secondDocumentId } =
      await seedGraph();
    const application = await createSubmissionApplication(programId);
    const snapshot = await editor.getMilestoneEdit(
      STAFF_GITHUB_ID,
      milestoneId,
    );
    const locked = deferred<void>();
    const release = deferred<void>();
    const submissionPrisma = pausingSubmissionPrisma(locked, release);
    const submission = upsertMilestoneDocumentSubmission(submissionPrisma, {
      milestoneDocumentId: firstDocumentId,
      applicationId: application.id,
      submittedById: application.studentId,
      submittedAt: new Date('2026-08-18T00:00:00.000Z'),
      expectedLatestReviewId: null,
      content: Prisma.JsonNull,
      attachFile: null,
    });
    await locked.promise;
    const aggregate = editor.updateMilestoneEdit(
      STAFF_GITHUB_ID,
      milestoneId,
      request(snapshot, [
        { id: secondDocumentId, name: 'Document 2', required: true },
      ]),
    );
    release.resolve();

    await expect(submission).resolves.toMatchObject({ status: 'SUBMITTED' });
    await expect(aggregate).rejects.toMatchObject({
      errorCode: { code: 'PRG_009' },
    });
    expect(
      await prisma.milestoneDocumentSubmissionHistory.count({
        where: { submission: { milestoneDocumentId: firstDocumentId } },
      }),
    ).toBe(1);
    expect(
      await prisma.milestoneDocument.findUnique({
        where: { id: firstDocumentId },
        select: { id: true },
      }),
    ).not.toBeNull();
  });

  it('deletes first and makes the real student submission refuse the missing document without resurrection', async () => {
    const { programId, milestoneId, firstDocumentId, secondDocumentId } =
      await seedGraph();
    const application = await createSubmissionApplication(programId);
    const snapshot = await editor.getMilestoneEdit(
      STAFF_GITHUB_ID,
      milestoneId,
    );
    await editor.updateMilestoneEdit(
      STAFF_GITHUB_ID,
      milestoneId,
      request(snapshot, [
        { id: secondDocumentId, name: 'Document 2', required: true },
      ]),
    );

    await expect(
      upsertMilestoneDocumentSubmission(prisma, {
        milestoneDocumentId: firstDocumentId,
        applicationId: application.id,
        submittedById: application.studentId,
        submittedAt: new Date('2026-08-18T00:00:00.000Z'),
        expectedLatestReviewId: null,
        content: Prisma.JsonNull,
        attachFile: null,
      }),
    ).rejects.toBeInstanceOf(MilestoneDocumentMissingError);
    expect(
      await prisma.milestoneDocumentSubmission.count({
        where: { milestoneDocumentId: firstDocumentId },
      }),
    ).toBe(0);
  });

  it('serializes aggregate-first replacement and a subsequent direct template write', async () => {
    const { milestoneId, firstDocumentId } = await seedGraph();
    const snapshot = await editor.getMilestoneEdit(
      STAFF_GITHUB_ID,
      milestoneId,
    );
    const uploadId = await createPendingUpload('aggregate-first');
    await editor.updateMilestoneEdit(
      STAFF_GITHUB_ID,
      milestoneId,
      request(snapshot, [
        {
          id: firstDocumentId,
          name: 'Document 1',
          required: true,
          templateUploadId: uploadId,
        },
        ...snapshot.documents.slice(1),
      ]),
    );
    const files = new MilestoneDocumentFilesService(
      new MilestoneDocumentsRepository(prisma),
      memoryStorage(),
      new SubmissionFilesRepository(prisma),
    );
    await expect(
      files.uploadTemplate(
        `${TEST_PREFIX}staff`,
        milestoneId,
        firstDocumentId,
        pdfUpload(),
      ),
    ).resolves.toMatchObject({ documentId: firstDocumentId });
    expect(
      await prisma.milestoneDocumentTemplateFile.findUniqueOrThrow({
        where: { milestoneDocumentId: firstDocumentId },
        select: { uploadedById: true },
      }),
    ).toEqual({ uploadedById: `${TEST_PREFIX}staff` });
  });

  it('rejects a cleanup-claimed DELETE_PENDING token before graph mutation', async () => {
    const { milestoneId, firstDocumentId } = await seedGraph();
    const uploadId = await createPendingUpload(
      'cleanup-claimed',
      new Date('2020-01-01T00:00:00.000Z'),
    );
    const claimed = await new ProgramAuthoringUploadRepository(
      prisma,
    ).claimForDeletion({
      now: new Date('2026-09-01T00:00:00.000Z'),
      leaseExpiresAt: new Date('2026-09-01T00:10:00.000Z'),
      limit: 1,
    });
    expect(claimed.map((upload) => upload.id)).toEqual([uploadId]);
    const snapshot = await editor.getMilestoneEdit(
      STAFF_GITHUB_ID,
      milestoneId,
    );
    const baseline = await graphBaseline(milestoneId, uploadId);

    await expect(
      editor.updateMilestoneEdit(
        STAFF_GITHUB_ID,
        milestoneId,
        request(snapshot, [
          {
            id: firstDocumentId,
            name: 'Should not mutate',
            required: true,
            templateUploadId: uploadId,
          },
          ...snapshot.documents.slice(1),
        ]),
      ),
    ).rejects.toMatchObject({
      errorCode: { code: ProgramErrorCode.VALIDATION_ERROR, status: 400 },
      extensions: {
        fieldErrors: [
          {
            field: 'documents[0].templateUploadId',
            code: 'INVALID_UPLOAD_TOKEN',
          },
        ],
      },
    });
    expect(await graphBaseline(milestoneId, uploadId)).toEqual(baseline);
  });

  it('lets aggregate consume win while an actual cleanup claim skips its locked token', async () => {
    const { milestoneId, firstDocumentId } = await seedGraph();
    const uploadId = await createPendingUpload('cleanup-overlap');
    const snapshot = await editor.getMilestoneEdit(
      STAFF_GITHUB_ID,
      milestoneId,
    );
    const locked = deferred<void>();
    const release = deferred<void>();
    const aggregate = pausingAggregateEditor(
      locked,
      release,
    ).updateMilestoneEdit(
      STAFF_GITHUB_ID,
      milestoneId,
      request(snapshot, [
        {
          id: firstDocumentId,
          name: 'Document 1',
          required: true,
          templateUploadId: uploadId,
        },
        ...snapshot.documents.slice(1),
      ]),
    );
    await locked.promise;
    const claim = await new ProgramAuthoringUploadRepository(
      prisma,
    ).claimForDeletion({
      now: new Date('2027-09-02T00:00:00.000Z'),
      leaseExpiresAt: new Date('2027-09-02T00:10:00.000Z'),
      limit: 1,
    });
    expect(claim).toEqual([]);
    release.resolve();
    const anyArrayMatcher: unknown = expect.any(Array);
    await expect(aggregate).resolves.toMatchObject({
      documents: anyArrayMatcher,
    });
    expect(
      await prisma.programAuthoringUpload.findUnique({
        where: { id: uploadId },
        select: { id: true },
      }),
    ).toBeNull();
    expect(
      await prisma.milestoneDocumentTemplateFile.findUnique({
        where: { milestoneDocumentId: firstDocumentId },
        select: { storageKey: true },
      }),
    ).toEqual({ storageKey: `program-authoring/${uploadId}` });
  });

  it('lets an actual cleanup claim win while aggregate is open before token locking', async () => {
    const { milestoneId, firstDocumentId } = await seedGraph();
    const uploadId = await createPendingUpload('cleanup-wins-overlap');
    const snapshot = await editor.getMilestoneEdit(
      STAFF_GITHUB_ID,
      milestoneId,
    );
    const locked = deferred<void>();
    const release = deferred<void>();
    const aggregate = pausingAggregateEditorAt(
      'countSubmissionHistoriesForDocuments',
      locked,
      release,
    ).updateMilestoneEdit(
      STAFF_GITHUB_ID,
      milestoneId,
      request(snapshot, [
        {
          id: firstDocumentId,
          name: 'Document 1',
          required: true,
          templateUploadId: uploadId,
        },
        ...snapshot.documents.slice(1),
      ]),
    );
    await locked.promise;
    const claimed = await new ProgramAuthoringUploadRepository(
      prisma,
    ).claimForDeletion({
      now: new Date('2027-09-02T00:00:00.000Z'),
      leaseExpiresAt: new Date('2027-09-02T00:10:00.000Z'),
      limit: 1,
    });
    expect(claimed.map((upload) => upload.id)).toEqual([uploadId]);
    release.resolve();
    await expect(aggregate).rejects.toMatchObject({
      errorCode: { code: ProgramErrorCode.VALIDATION_ERROR, status: 400 },
      extensions: {
        fieldErrors: [
          {
            field: 'documents[0].templateUploadId',
            code: 'INVALID_UPLOAD_TOKEN',
          },
        ],
      },
    });
    expect(
      await prisma.milestoneDocumentTemplateFile.findUnique({
        where: { milestoneDocumentId: firstDocumentId },
        select: { id: true },
      }),
    ).toBeNull();
    expect(
      await prisma.programAuthoringUpload.findUniqueOrThrow({
        where: { id: uploadId },
        select: { lifecycle: true },
      }),
    ).toEqual({ lifecycle: ProgramAuthoringUploadLifecycle.DELETE_PENDING });
  });

  it('rolls back the complete graph after real aggregate writes when the transaction callback aborts before commit', async () => {
    const { milestoneId, firstDocumentId, secondDocumentId } =
      await seedGraph();
    const uploadId = await createPendingUpload('rollback-template');
    const snapshot = await editor.getMilestoneEdit(
      STAFF_GITHUB_ID,
      milestoneId,
    );
    const baseline = await graphBaseline(milestoneId, uploadId);
    const faultingEditor = createFaultingEditor('applyMilestoneEdit');

    await expect(
      faultingEditor.updateMilestoneEdit(STAFF_GITHUB_ID, milestoneId, {
        ...request(snapshot, [
          {
            id: secondDocumentId,
            name: 'Updated second',
            required: false,
            templateUploadId: uploadId,
          },
          { id: null, name: 'Inserted document', required: true },
        ]),
        name: 'Changed metadata',
        instructions: 'Changed instructions',
      }),
    ).rejects.toThrow('Injected aggregate transaction fault');

    expect(await graphBaseline(milestoneId, uploadId)).toEqual(baseline);
    expect(
      await prisma.milestoneDocument.findUnique({
        where: { id: firstDocumentId },
        select: { id: true },
      }),
    ).not.toBeNull();
  });

  it('rolls back after token locking and after deletion eligibility checks before any graph write', async () => {
    const { milestoneId, firstDocumentId } = await seedGraph();
    const uploadId = await createPendingUpload('rollback-lock');
    const snapshot = await editor.getMilestoneEdit(
      STAFF_GITHUB_ID,
      milestoneId,
    );
    const baseline = await graphBaseline(milestoneId, uploadId);
    const fullRequest = request(snapshot, [
      {
        id: firstDocumentId,
        name: 'Updated first',
        required: true,
        templateUploadId: uploadId,
      },
      ...snapshot.documents.slice(1),
    ]);

    await expect(
      createFaultingEditor('lockAttachableUploads').updateMilestoneEdit(
        STAFF_GITHUB_ID,
        milestoneId,
        fullRequest,
      ),
    ).rejects.toThrow('Injected aggregate transaction fault');
    expect(await graphBaseline(milestoneId, uploadId)).toEqual(baseline);

    await expect(
      createFaultingEditor(
        'countSubmissionHistoriesForDocuments',
      ).updateMilestoneEdit(STAFF_GITHUB_ID, milestoneId, fullRequest),
    ).rejects.toThrow('Injected aggregate transaction fault');
    expect(await graphBaseline(milestoneId, uploadId)).toEqual(baseline);
  });

  it('rolls back a no-file aggregate callback immediately before commit', async () => {
    const { milestoneId, firstDocumentId, secondDocumentId } =
      await seedGraph();
    const uploadId = await createPendingUpload('rollback-no-file-baseline');
    const snapshot = await editor.getMilestoneEdit(
      STAFF_GITHUB_ID,
      milestoneId,
    );
    const baseline = await graphBaseline(milestoneId, uploadId);

    await expect(
      createFaultingEditor('applyMilestoneEdit').updateMilestoneEdit(
        STAFF_GITHUB_ID,
        milestoneId,
        {
          ...request(snapshot, [
            {
              id: secondDocumentId,
              name: 'Reordered second',
              required: false,
            },
            { id: null, name: 'No-file insertion', required: true },
          ]),
          name: 'No-file metadata change',
        },
      ),
    ).rejects.toThrow('Injected aggregate transaction fault');
    expect(await graphBaseline(milestoneId, uploadId)).toEqual(baseline);
    expect(
      await prisma.milestoneDocument.findUnique({
        where: { id: firstDocumentId },
        select: { id: true },
      }),
    ).not.toBeNull();
  });

  it.each([
    ['milestone metadata update', 'Milestone', 'UPDATE', 'id'],
    ['new document insert', 'MilestoneDocument', 'INSERT', 'milestoneId'],
    ['document delete', 'MilestoneDocument', 'DELETE', 'id'],
    [
      'existing document sort order update',
      'MilestoneDocument',
      'UPDATE',
      'id',
    ],
  ] as const)(
    'rolls back every real DB write when an AFTER trigger faults after %s',
    async (_label, table, event, targetColumn) => {
      const { milestoneId, firstDocumentId, secondDocumentId } =
        await seedGraph();
      const snapshot = await editor.getMilestoneEdit(
        STAFF_GITHUB_ID,
        milestoneId,
      );
      const targetId =
        table === 'Milestone' || targetColumn === 'milestoneId'
          ? milestoneId
          : event === 'DELETE'
            ? firstDocumentId
            : secondDocumentId;
      const drop = await installSyntheticAggregateFaultTrigger({
        table,
        event,
        targetColumn,
        targetId,
      });
      try {
        const baseline = await graphBaseline(
          milestoneId,
          await createPendingUpload(`fault-${event}-${targetColumn}`),
        );
        const documents =
          event === 'DELETE'
            ? [{ id: secondDocumentId, name: 'Document 2', required: true }]
            : event === 'INSERT'
              ? [
                  ...snapshot.documents,
                  { id: null, name: 'Inserted fault document', required: true },
                ]
              : [
                  { id: secondDocumentId, name: 'Document 2', required: false },
                  { id: firstDocumentId, name: 'Document 1', required: true },
                ];
        await expect(
          editor.updateMilestoneEdit(STAFF_GITHUB_ID, milestoneId, {
            ...request(snapshot, documents),
            name: 'Faulted metadata update',
          }),
        ).rejects.toThrow('synthetic aggregate fault');
        expect(await graphBaseline(milestoneId, baseline.upload.id)).toEqual(
          baseline,
        );
      } finally {
        await drop();
      }
    },
  );

  it.each(['INSERT', 'UPDATE'] as const)(
    'rolls back template upsert %s and pending-token consumption after its real DB statement faults',
    async (event) => {
      const { milestoneId, firstDocumentId } = await seedGraph();
      if (event === 'UPDATE') {
        await prisma.milestoneDocumentTemplateFile.create({
          data: {
            milestoneDocumentId: firstDocumentId,
            storageKey: 'objects/original-template',
            originalFileName: 'original.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 1,
            uploadedById: `${TEST_PREFIX}staff`,
          },
        });
      }
      const uploadId = await createPendingUpload(`template-${event}`);
      const snapshot = await editor.getMilestoneEdit(
        STAFF_GITHUB_ID,
        milestoneId,
      );
      const baseline = await graphBaseline(milestoneId, uploadId);
      const drop = await installSyntheticAggregateFaultTrigger({
        table: 'MilestoneDocumentTemplateFile',
        event,
        targetColumn: 'milestoneDocumentId',
        targetId: firstDocumentId,
      });
      try {
        await expect(
          editor.updateMilestoneEdit(
            STAFF_GITHUB_ID,
            milestoneId,
            request(snapshot, [
              {
                id: firstDocumentId,
                name: 'Document 1',
                required: true,
                templateUploadId: uploadId,
              },
              ...snapshot.documents.slice(1),
            ]),
          ),
        ).rejects.toThrow('synthetic aggregate fault');
        expect(await graphBaseline(milestoneId, uploadId)).toEqual(baseline);
      } finally {
        await drop();
      }
    },
  );

  it('rolls back template pointer and graph when AFTER pending-upload DELETE faults', async () => {
    const { milestoneId, firstDocumentId } = await seedGraph();
    const uploadId = await createPendingUpload('pending-delete');
    const snapshot = await editor.getMilestoneEdit(
      STAFF_GITHUB_ID,
      milestoneId,
    );
    const baseline = await graphBaseline(milestoneId, uploadId);
    const drop = await installSyntheticAggregateFaultTrigger({
      table: 'ProgramAuthoringUpload',
      event: 'DELETE',
      targetColumn: 'id',
      targetId: uploadId,
    });
    try {
      await expect(
        editor.updateMilestoneEdit(
          STAFF_GITHUB_ID,
          milestoneId,
          request(snapshot, [
            {
              id: firstDocumentId,
              name: 'Document 1',
              required: true,
              templateUploadId: uploadId,
            },
            ...snapshot.documents.slice(1),
          ]),
        ),
      ).rejects.toThrow('synthetic aggregate fault');
      expect(await graphBaseline(milestoneId, uploadId)).toEqual(baseline);
    } finally {
      await drop();
    }
  });

  it('rolls back at the real deferred constraint trigger commit boundary', async () => {
    const { milestoneId, firstDocumentId } = await seedGraph();
    const uploadId = await createPendingUpload('deferred-commit');
    const snapshot = await editor.getMilestoneEdit(
      STAFF_GITHUB_ID,
      milestoneId,
    );
    const baseline = await graphBaseline(milestoneId, uploadId);
    const drop = await installSyntheticAggregateFaultTrigger({
      table: 'ProgramAuthoringUpload',
      event: 'DELETE',
      targetColumn: 'id',
      targetId: uploadId,
      deferred: true,
    });
    try {
      await expect(
        editor.updateMilestoneEdit(
          STAFF_GITHUB_ID,
          milestoneId,
          request(snapshot, [
            {
              id: firstDocumentId,
              name: 'Document 1',
              required: true,
              templateUploadId: uploadId,
            },
            ...snapshot.documents.slice(1),
          ]),
        ),
      ).rejects.toThrow('synthetic aggregate fault');
      expect(await graphBaseline(milestoneId, uploadId)).toEqual(baseline);
    } finally {
      await drop();
    }
  });
});

/**
 * 공용 `cleanup`은 팀·사용자를 지우지만 `TeamMember`는 모른다. 이 파일만 제출 관문(#1269)이
 * 요구하는 멤버 행을 심으므로, 팀 삭제가 FK에 걸리지 않도록 여기서 먼저 걷어낸다.
 */
async function resetGraph(): Promise<void> {
  await prisma.teamMember.deleteMany({
    where: { teamId: { startsWith: `${TEST_PREFIX}team:` } },
  });
  await cleanup();
}

async function seedGraph(options: { readonly documentCount?: number } = {}) {
  const programId = `${TEST_PREFIX}program:aggregate:${crypto.randomUUID()}`;
  const milestoneId = `${TEST_PREFIX}milestone:aggregate:${crypto.randomUUID()}`;
  await createProgram(programId, false);
  await createMilestone(milestoneId, programId);
  const documentCount = options.documentCount ?? 2;
  const documents = await Promise.all(
    Array.from({ length: documentCount }, (_, index) =>
      prisma.milestoneDocument.create({
        data: {
          id: `${TEST_PREFIX}document:aggregate:${crypto.randomUUID()}`,
          milestoneId,
          kind: MilestoneDocumentKind.DOCUMENT,
          name: `Document ${index + 1}`,
          required: true,
          sortOrder: index + 1,
        },
        select: { id: true },
      }),
    ),
  );
  return {
    programId,
    milestoneId,
    firstDocumentId: documents[0]?.id ?? '',
    secondDocumentId: documents[1]?.id ?? '',
  };
}

async function createSubmissionApplication(programId: string) {
  const studentId = `${TEST_PREFIX}student:${crypto.randomUUID()}`;
  const teamId = `${TEST_PREFIX}team:${crypto.randomUUID()}`;
  const applicationId = `${TEST_PREFIX}application:${crypto.randomUUID()}`;
  await prisma.user.create({
    data: {
      id: studentId,
      githubId: 9_102_000_000n + BigInt(++studentSequence),
      nickname: `student-${studentId.slice(-8)}`,
      selectedMemberKind: MemberKind.STUDENT,
      accountStatus: 'ACTIVE',
    },
  });
  await prisma.team.create({
    data: {
      id: teamId,
      programId,
      name: 'Submission team',
      joinCodeDigest: crypto.randomUUID(),
      leaderId: studentId,
    },
  });
  // 제출 쓰기 관문(#1269)은 `Team.leaderId`가 아니라 **지금의 `TeamMember` 행**으로
  // 권한을 판정한다. 팀장도 생성 시 자기 멤버 행을 함께 갖는 실제 모양이라, 여기서도
  // 같은 행을 심어야 이 파일의 경합 시나리오가 「정상 팀원」으로 출발한다.
  // `programId`는 Team(id, programId) 복합 FK가 요구하는 비정규화 사본이다(#164).
  await prisma.teamMember.create({
    data: {
      id: `${TEST_PREFIX}team-member:${crypto.randomUUID()}`,
      teamId,
      programId,
      userId: studentId,
    },
  });
  await prisma.application.create({
    data: {
      id: applicationId,
      programId,
      applicantId: studentId,
      teamId,
      answers: {},
      applicationTemplateVersion: 1,
    },
  });
  return { id: applicationId, studentId };
}

function request(
  snapshot: Awaited<ReturnType<typeof editor.getMilestoneEdit>>,
  documents: readonly {
    readonly id: string | null;
    readonly name: string;
    readonly required: boolean;
    readonly templateUploadId?: string;
  }[],
) {
  return {
    expectedFingerprint: snapshot.fingerprint,
    name: snapshot.milestone.name,
    startAt: snapshot.milestone.startAt.toISOString(),
    dueAt: snapshot.milestone.dueAt.toISOString(),
    instructions: snapshot.milestone.instructions,
    documents,
  };
}

async function createPendingUpload(
  label: string,
  expiresAt = new Date('2027-09-01T00:00:00.000Z'),
): Promise<string> {
  const id = `${TEST_PREFIX}upload:${label}:${crypto.randomUUID()}`;
  await prisma.programAuthoringUpload.create({
    data: {
      id,
      actorId: `${TEST_PREFIX}staff`,
      storageKey: `program-authoring/${id}`,
      originalFileName: 'form.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 12,
      sha256: 'a'.repeat(64),
      lifecycle: ProgramAuthoringUploadLifecycle.PENDING,
      expiresAt,
    },
  });
  return id;
}

function createFaultingEditor(
  method:
    | 'applyMilestoneEdit'
    | 'lockAttachableUploads'
    | 'countSubmissionHistoriesForDocuments',
): ProgramEditorService {
  const actual = new ProgramEditorRepository(prisma);
  const repository: ProgramEditorRepositoryPort = {
    withTransaction: (operation) =>
      actual.withTransaction(async (store) => {
        const overrides =
          method === 'applyMilestoneEdit'
            ? {
                applyMilestoneEdit: async (
                  input: Parameters<
                    ProgramEditorTransactionStore['applyMilestoneEdit']
                  >[0],
                ) => {
                  await store.applyMilestoneEdit(input);
                  throw new Error('Injected aggregate transaction fault');
                },
              }
            : method === 'lockAttachableUploads'
              ? {
                  lockAttachableUploads: async (
                    actorId: Parameters<
                      ProgramEditorTransactionStore['lockAttachableUploads']
                    >[0],
                    tokenIds: Parameters<
                      ProgramEditorTransactionStore['lockAttachableUploads']
                    >[1],
                  ) => {
                    await store.lockAttachableUploads(actorId, tokenIds);
                    throw new Error('Injected aggregate transaction fault');
                  },
                }
              : {
                  countSubmissionHistoriesForDocuments: async (
                    documentIds: Parameters<
                      ProgramEditorTransactionStore['countSubmissionHistoriesForDocuments']
                    >[0],
                  ) => {
                    await store.countSubmissionHistoriesForDocuments(
                      documentIds,
                    );
                    throw new Error('Injected aggregate transaction fault');
                  },
                };
        return operation(instrumentStore(store, overrides));
      }),
  };
  return new ProgramEditorService(repository);
}

function pausingAggregateEditor(
  locked: ReturnType<typeof deferred<void>>,
  release: ReturnType<typeof deferred<void>>,
): ProgramEditorService {
  return pausingAggregateEditorAt('lockAttachableUploads', locked, release);
}

function pausingAggregateEditorAt(
  method: 'lockAttachableUploads' | 'countSubmissionHistoriesForDocuments',
  locked: ReturnType<typeof deferred<void>>,
  release: ReturnType<typeof deferred<void>>,
): ProgramEditorService {
  const actual = new ProgramEditorRepository(prisma);
  const repository: ProgramEditorRepositoryPort = {
    withTransaction: (operation) =>
      actual.withTransaction(async (store) => {
        const overrides =
          method === 'lockAttachableUploads'
            ? {
                lockAttachableUploads: async (
                  actorId: Parameters<
                    ProgramEditorTransactionStore['lockAttachableUploads']
                  >[0],
                  tokenIds: Parameters<
                    ProgramEditorTransactionStore['lockAttachableUploads']
                  >[1],
                ) => {
                  const result = await store.lockAttachableUploads(
                    actorId,
                    tokenIds,
                  );
                  locked.resolve();
                  await release.promise;
                  return result;
                },
              }
            : {
                countSubmissionHistoriesForDocuments: async (
                  documentIds: Parameters<
                    ProgramEditorTransactionStore['countSubmissionHistoriesForDocuments']
                  >[0],
                ) => {
                  const result =
                    await store.countSubmissionHistoriesForDocuments(
                      documentIds,
                    );
                  locked.resolve();
                  await release.promise;
                  return result;
                },
              };
        return operation(instrumentStore(store, overrides));
      }),
  };
  return new ProgramEditorService(repository);
}

function instrumentStore(
  store: ProgramEditorTransactionStore,
  overrides: Partial<ProgramEditorTransactionStore>,
): ProgramEditorTransactionStore {
  return {
    findUserAuthorityByGithubId: (githubId) =>
      store.findUserAuthorityByGithubId(githubId),
    findEditableProgramById: (programId) =>
      store.findEditableProgramById(programId),
    findEditableProgramForUpdate: (programId) =>
      store.findEditableProgramForUpdate(programId),
    updateProgram: (input) => store.updateProgram(input),
    findProgramScheduleForMilestoneCreate: (programId) =>
      store.findProgramScheduleForMilestoneCreate(programId),
    createMilestone: (input) => store.createMilestone(input),
    findMilestoneForUpdate: (milestoneId) =>
      store.findMilestoneForUpdate(milestoneId),
    updateMilestone: (input) => store.updateMilestone(input),
    findMilestoneForDelete: (milestoneId) =>
      store.findMilestoneForDelete(milestoneId),
    deleteMilestone: (milestoneId) => store.deleteMilestone(milestoneId),
    lockMilestoneEdit: (milestoneId) => store.lockMilestoneEdit(milestoneId),
    countSubmissionHistoriesForDocuments:
      overrides.countSubmissionHistoriesForDocuments ??
      ((documentIds) =>
        store.countSubmissionHistoriesForDocuments(documentIds)),
    lockAttachableUploads:
      overrides.lockAttachableUploads ??
      ((actorId, tokenIds) => store.lockAttachableUploads(actorId, tokenIds)),
    applyMilestoneEdit:
      overrides.applyMilestoneEdit ??
      ((input) => store.applyMilestoneEdit(input)),
  };
}

async function graphBaseline(milestoneId: string, uploadId: string) {
  const [milestone, documents, upload] = await Promise.all([
    prisma.milestone.findUniqueOrThrow({
      where: { id: milestoneId },
      select: {
        name: true,
        startAt: true,
        dueAt: true,
        instructions: true,
      },
    }),
    prisma.milestoneDocument.findMany({
      where: { milestoneId },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        kind: true,
        name: true,
        required: true,
        sortOrder: true,
        templateFile: {
          select: {
            storageKey: true,
            originalFileName: true,
            mimeType: true,
            sizeBytes: true,
          },
        },
      },
    }),
    prisma.programAuthoringUpload.findUniqueOrThrow({
      where: { id: uploadId },
      select: { id: true, lifecycle: true, storageKey: true },
    }),
  ]);
  return { milestone, documents, upload };
}

function memoryStorage(): SubmissionFileStoragePort {
  return {
    put: (input) =>
      Promise.resolve({
        objectKey: input.objectKey ?? `objects/${crypto.randomUUID()}`,
        originalName: input.originalName,
        contentLength: input.body.byteLength,
        contentType: input.contentType,
      }),
    get: () => Promise.resolve(Readable.from(Buffer.alloc(0))),
    delete: () => Promise.resolve(),
  };
}

function pdfUpload() {
  const buffer = Buffer.from('%PDF-1.4\\n');
  return {
    buffer,
    originalname: 'form.pdf',
    mimetype: 'application/pdf',
    size: buffer.byteLength,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function pausingSubmissionPrisma(
  locked: ReturnType<typeof deferred<void>>,
  release: ReturnType<typeof deferred<void>>,
): PrismaService {
  return new PausingSubmissionPrisma(locked, release);
}

class PausingSubmissionPrisma extends PrismaService {
  constructor(
    private readonly locked: ReturnType<typeof deferred<void>>,
    private readonly release: ReturnType<typeof deferred<void>>,
  ) {
    super();
  }

  override $transaction<P extends Prisma.PrismaPromise<unknown>[]>(
    operations: [...P],
    options?: {
      readonly isolationLevel?: Prisma.TransactionIsolationLevel;
    },
  ): Promise<UnwrapTuple<P>>;
  override $transaction<T>(
    operation: (transaction: Prisma.TransactionClient) => Promise<T>,
    options?: {
      readonly maxWait?: number;
      readonly timeout?: number;
      readonly isolationLevel?: Prisma.TransactionIsolationLevel;
    },
  ): Promise<T>;
  override $transaction<T>(
    operation:
      | ((transaction: Prisma.TransactionClient) => Promise<T>)
      | readonly Prisma.PrismaPromise<unknown>[],
    options?: {
      readonly maxWait?: number;
      readonly timeout?: number;
      readonly isolationLevel?: Prisma.TransactionIsolationLevel;
    },
  ): Promise<T | UnwrapTuple<Prisma.PrismaPromise<unknown>[]>> {
    if (typeof operation === 'function') {
      return this.interactiveTransaction(operation, options);
    }
    return prisma.$transaction([...operation], options);
  }

  private interactiveTransaction<T>(
    operation: (transaction: Prisma.TransactionClient) => Promise<T>,
    options?: {
      readonly maxWait?: number;
      readonly timeout?: number;
      readonly isolationLevel?: Prisma.TransactionIsolationLevel;
    },
  ): Promise<T> {
    return prisma.$transaction(async (transaction) => {
      const locked = this.locked;
      const release = this.release;
      let paused = false;
      const proxy = new Proxy(transaction, {
        get(target, property, receiver) {
          const value: unknown = Reflect.get(target, property, receiver);
          if (property !== '$queryRaw') {
            return value;
          }
          return async <T>(query: Prisma.Sql): Promise<T> => {
            const result = await target.$queryRaw<T>(query);
            const sql = query.strings?.join('') ?? '';
            if (
              !paused &&
              sql.includes('FROM "MilestoneDocument"') &&
              sql.includes('FOR UPDATE')
            ) {
              paused = true;
              locked.resolve();
              await release.promise;
            }
            return result;
          };
        },
      });
      return operation(proxy);
    }, options);
  }
}
