import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { signatureValidZip } from './submission-zip-builder.fixture';
import { MilestoneDocumentsErrorCode } from './submissions.error';
import {
  MilestoneDocumentFlowFixture,
  flowIds,
} from './milestone-document-flow.integration-fixture';
assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});
const fixture = new MilestoneDocumentFlowFixture();
async function upload(
  name: string,
  type: string,
  bytes: Buffer,
): Promise<Response> {
  const body = new FormData();
  body.append('milestoneId', flowIds.milestone);
  body.append('documentId', flowIds.document);
  body.append('file', new Blob([new Uint8Array(bytes)], { type }), name);
  return fixture.request('milestone-document-files', { method: 'POST', body });
}
async function check(bytes: Buffer): Promise<Response> {
  const body = new FormData();
  body.append(
    'file',
    new Blob([new Uint8Array(bytes)], { type: 'application/zip' }),
    'bundle.zip',
  );
  return fixture.request('milestone-document-files/checks', {
    method: 'POST',
    body,
  });
}
async function footprint() {
  return {
    submissionFiles: await fixture.prisma.file.count(),
    teamHistories: await fixture.prisma.teamHistory.count(),
    outboxEvents: await fixture.prisma.outboxEvent.count(),
  };
}
describe('QA152 current file HTTP + PostgreSQL + object-storage', () => {
  beforeAll(() => fixture.start());
  beforeEach(() => fixture.reset());
  afterAll(() => fixture.stop());
  it.each([
    ['FILE', true, false, false],
    ['FILE', false, true, true],
    ['FILE', true, true, true],
    ['TEXT', true, false, true],
    ['TEXT', false, true, false],
    ['TEXT', true, true, true],
    ['FILE_OR_TEXT', true, false, true],
    ['FILE_OR_TEXT', false, true, true],
    ['FILE_OR_TEXT', true, true, true],
  ] as const)(
    'preserves %s input semantics for text=%s file=%s and retains the optional comment',
    async (submissionType, hasText, hasFile, accepted) => {
      await fixture.prisma.requirement.update({
        where: { id: flowIds.document },
        data: { submissionType },
      });
      if (submissionType === 'FILE') {
        await fixture.prisma.milestone.update({
          where: { id: flowIds.milestone },
          data: {},
        });
        await fixture.prisma.requirement.update({
          where: { id: flowIds.document },
          data: {},
        });
      }
      let fileId = 'synthetic-unused-file';
      if (hasFile && submissionType !== 'TEXT') {
        const uploaded = await upload(
          'rule.pdf',
          'application/pdf',
          Buffer.from('%PDF-rule'),
        );
        expect(uploaded.status).toBe(201);
        const pending = await fixture.prisma.file.findFirstOrThrow({
          where: {
            kind: 'SUBMISSION',
            requirementId: flowIds.document,
            lifecycle: 'PENDING',
          },
          select: { id: true },
        });
        fileId = pending.id;
      }
      const response = await fixture.request(
        `${fixture.documentPath()}/submissions`,
        {
          method: 'POST',
          json: {
            content: {
              ...(hasText ? { text: 'rule content' } : {}),
              ...(hasFile ? { fileId } : {}),
            },
            comment: '  retained comment  ',
          },
        },
      );
      expect(response.status).toBe(accepted ? 201 : 422);
      const events = await fixture.prisma.submissionHistory.findMany({
        where: { submission: { requirementId: flowIds.document } },
        select: {
          event: true,
          comment: true,
          content: true,
          files: { select: { id: true } },
        },
      });
      expect(events).toEqual(
        accepted
          ? [
              {
                event: 'SUBMITTED',
                comment: 'retained comment',
                content:
                  hasText && submissionType !== 'FILE'
                    ? { type: 'TEXT', text: 'rule content' }
                    : submissionType === 'FILE'
                      ? { type: 'FILE' }
                      : null,
                files:
                  hasFile && submissionType !== 'TEXT' ? [{ id: fileId }] : [],
              },
            ]
          : [],
      );
      if (accepted && submissionType === 'FILE') {
        const submission = await fixture.prisma.submission.findFirstOrThrow({
          where: { requirementId: flowIds.document },
          select: { id: true },
        });
        const legacyView = await fixture.request(
          'submissions/' + submission.id + '/review-context',
          { actor: 'staff' },
        );
        expect(legacyView.status).toBe(200);
        expect(await legacyView.json()).toMatchObject({
          currentRevision: {
            content: { type: 'FILE' },
            files: [expect.objectContaining({ fileId })],
          },
        });
      }
    },
  );
  it('blocks another file after the one allowed post-deadline resubmission', async () => {
    expect((await fixture.submit('최초 제출')).status).toBe(201);
    expect(
      (
        await fixture.request(
          `${fixture.documentPath()}/teams/${flowIds.team}/reviews`,
          {
            actor: 'staff',
            method: 'POST',
            json: {
              decision: 'CHANGES_REQUESTED',
              expectedRevision: 1,
              expectedLatestReviewId: null,
              comment: '실행 결과를 보완해 주세요.',
              resubmissionDueAt: '2099-12-31T00:00:00.000Z',
            },
          },
        )
      ).status,
    ).toBe(201);
    await fixture.closeDeadline();
    expect((await fixture.submit('첫 보완')).status).toBe(201);
    const response = await upload(
      'revised.pdf',
      'application/pdf',
      Buffer.from('%PDF-revised'),
    );
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      code: MilestoneDocumentsErrorCode.RESUBMISSION_ALREADY_USED,
    });
    expect(
      await fixture.prisma.file.count({
        where: { kind: 'SUBMISSION', teamId: flowIds.team },
      }),
    ).toBe(0);
    expect(
      await fixture.prisma.submission.findFirstOrThrow({
        where: { requirementId: flowIds.document },
        select: { status: true, revision: true },
      }),
    ).toEqual({ status: 'SUBMITTED', revision: 2 });
  });
  it.each([
    [
      'report.hwp',
      'application/x-hwp',
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    ],
    ['report.pdf', 'application/pdf', Buffer.from('%PDF-synthetic')],
    [
      'report.zip',
      'application/zip',
      signatureValidZip([{ name: 'synthetic.txt' }]),
    ],
  ])(
    'uploads and submits %s without requiring text',
    async (name, mime, bytes) => {
      const response = await upload(name, mime, bytes);
      expect(response.status).toBe(201);
      const pending = await fixture.prisma.file.findFirstOrThrow({
        where: { kind: 'SUBMISSION', teamId: flowIds.team },
      });
      expect(pending.requirementId).toBe(flowIds.document);
      expect((await fixture.submit('', pending.id)).status).toBe(201);
      const downloaded = await fixture.request(
        `${fixture.documentPath()}/submissions/current/file`,
      );
      expect(downloaded.status).toBe(200);
      expect(Buffer.from(await downloaded.arrayBuffer())).toEqual(bytes);
    },
  );
  it.each([
    ['photo.jpg', 'image/jpeg', Buffer.from([0xff, 0xd8, 0xff])],
    ['photo.jpeg', 'image/jpeg', Buffer.from([0xff, 0xd8, 0xff])],
    [
      'image.png',
      'image/png',
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ],
  ])(
    'rejects a new %s before creating a pending file',
    async (name, mime, bytes) => {
      const response = await upload(name, mime, bytes);
      expect(response.status).toBe(415);
      expect(
        await fixture.prisma.file.count({
          where: { kind: 'SUBMISSION', teamId: flowIds.team },
        }),
      ).toBe(0);
    },
  );
  it('checks a ZIP with the upload codes over real guards and stores nothing', async () => {
    const locked = signatureValidZip([
      {
        name: 'plan.txt',
        flags: 0x0001,
        compressedSize: 1 + 12,
        uncompressedSize: 1,
      },
    ]);
    const nested = signatureValidZip([{ name: 'inner.zip' }]);
    const put = jest.spyOn(fixture.storage, 'put');
    const before = await footprint();
    for (const [archive, code] of [
      [locked, MilestoneDocumentsErrorCode.ZIP_PASSWORD_PROTECTED],
      [nested, MilestoneDocumentsErrorCode.ZIP_NESTED],
    ] as const) {
      const checked = await check(archive);
      const uploaded = await upload('bundle.zip', 'application/zip', archive);
      expect(checked.status).toBe(422);
      expect(uploaded.status).toBe(422);
      const uploadedProblem: unknown = await uploaded.json();
      expect(uploadedProblem).toMatchObject({ code });
      expect(await checked.json()).toMatchObject({
        code,
        detail: (
          uploadedProblem as {
            detail: string;
          }
        ).detail,
      });
    }
    expect(
      (await check(signatureValidZip([{ name: 'plan.txt' }]))).status,
    ).toBe(204);
    expect(put).not.toHaveBeenCalled();
    expect(await footprint()).toEqual(before);
    put.mockRestore();
  });
  it('keeps an existing image downloadable without changing retention', async () => {
    await fixture.submit('기존 이미지가 있는 제출');
    const history = await fixture.prisma.submissionHistory.findFirstOrThrow({
      where: { submission: { requirementId: flowIds.document } },
    });
    const bytes = Buffer.from([0xff, 0xd8, 0xff]);
    const storageKey = 'qa152-synthetic/existing-image';
    await fixture.storage.put({
      body: bytes,
      contentType: 'image/jpeg',
      originalName: 'existing.jpg',
      objectKey: storageKey,
    });
    const expiresAt = new Date('2099-12-31');
    const file = await fixture.prisma.file.create({
      data: {
        kind: 'SUBMISSION',
        uploaderId: flowIds.student,
        teamId: flowIds.team,
        submissionId: history.submissionId,
        submissionHistoryId: history.id,
        lifecycle: 'ATTACHED',
        expiresAt: expiresAt,
        storageKey: storageKey,
        originalFileName: 'existing.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: bytes.length,
      },
    });
    const response = await fixture.request(
      `${fixture.documentPath()}/submissions/current/file`,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    expect(
      await fixture.prisma.file.findUnique({
        where: { kind: 'SUBMISSION', id: file.id },
        select: { lifecycle: true, expiresAt: true },
      }),
    ).toEqual({ lifecycle: 'ATTACHED', expiresAt });
  });
  it('omits an old attachment from a text-only revision but keeps its history and stored file', async () => {
    await upload(
      'previous.pdf',
      'application/pdf',
      Buffer.from('%PDF-synthetic'),
    );
    const file = await fixture.prisma.file.findFirstOrThrow({
      where: { kind: 'SUBMISSION', teamId: flowIds.team },
    });
    await fixture.submit('첫 제출', file.id);
    expect((await fixture.submit('이번 제출은 글만 포함합니다.')).status).toBe(
      201,
    );
    expect(
      (
        await fixture.request(
          `${fixture.documentPath()}/submissions/current/file`,
        )
      ).status,
    ).toBe(404);
    const stored = await fixture.prisma.file.findUniqueOrThrow({
      where: { kind: 'SUBMISSION', id: file.id },
      select: {
        lifecycle: true,
        submissionHistory: { select: { revision: true } },
      },
    });
    expect(stored).toEqual({
      lifecycle: 'ATTACHED',
      submissionHistory: { revision: 1 },
    });
    const history = await fixture.request(`${fixture.documentPath()}/history`);
    const body: unknown = await history.json();
    expect(body).toHaveProperty(
      'items',
      expect.arrayContaining([
        expect.objectContaining({ revision: 1, fileName: 'previous.pdf' }),
      ]),
    );
  });
});
