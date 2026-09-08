import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { signatureValidZip } from '../submissions/submission-zip-test-builder';
import { MilestoneDocumentsErrorCode } from './milestone-documents-error-code.enum';
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

describe('QA152 current file HTTP + PostgreSQL + MinIO', () => {
  beforeAll(() => fixture.start());
  beforeEach(() => fixture.reset());
  afterAll(() => fixture.stop());

  it('blocks another file after the one allowed post-deadline resubmission', async () => {
    // Given
    expect((await fixture.submit('최초 제출')).status).toBe(201);
    expect(
      (
        await fixture.request(
          `${fixture.documentPath()}/applications/${flowIds.application}/reviews`,
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

    // When
    const response = await upload(
      'revised.pdf',
      'application/pdf',
      Buffer.from('%PDF-revised'),
    );

    // Then
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      code: MilestoneDocumentsErrorCode.RESUBMISSION_ALREADY_USED,
    });
    expect(
      await fixture.prisma.submissionFile.count({
        where: { applicationId: flowIds.application },
      }),
    ).toBe(0);
    expect(
      await fixture.prisma.milestoneDocumentSubmission.findFirstOrThrow({
        where: { milestoneDocumentId: flowIds.document },
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
      // Given / When
      const response = await upload(name, mime, bytes);

      // Then: 실제 multipart 파서·형식 검사·DB·스토리지를 통과한다.
      expect(response.status).toBe(201);
      const pending = await fixture.prisma.submissionFile.findFirstOrThrow({
        where: { applicationId: flowIds.application },
      });
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
      // Given / When
      const response = await upload(name, mime, bytes);

      // Then
      expect(response.status).toBe(415);
      expect(
        await fixture.prisma.submissionFile.count({
          where: { applicationId: flowIds.application },
        }),
      ).toBe(0);
    },
  );

  it('keeps an existing image downloadable without changing retention', async () => {
    // Given: 정책 변경 전에 저장된 파일을 합성 데이터로 만든다.
    await fixture.submit('기존 이미지가 있는 제출');
    const history =
      await fixture.prisma.milestoneDocumentSubmissionHistory.findFirstOrThrow({
        where: { submission: { milestoneDocumentId: flowIds.document } },
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
    const file = await fixture.prisma.submissionFile.create({
      data: {
        uploaderId: flowIds.student,
        applicationId: flowIds.application,
        milestoneId: flowIds.milestone,
        milestoneDocumentSubmissionId: history.milestoneDocumentSubmissionId,
        milestoneDocumentSubmissionHistoryId: history.id,
        lifecycle: 'ATTACHED',
        expiresAt,
        storageKey,
        originalFileName: 'existing.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: bytes.length,
      },
    });

    // When
    const response = await fixture.request(
      `${fixture.documentPath()}/submissions/current/file`,
    );

    // Then
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    expect(
      await fixture.prisma.submissionFile.findUnique({
        where: { id: file.id },
        select: { lifecycle: true, expiresAt: true },
      }),
    ).toEqual({ lifecycle: 'ATTACHED', expiresAt });
  });

  it('omits an old attachment from a text-only revision but keeps its history and stored file', async () => {
    // Given
    await upload(
      'previous.pdf',
      'application/pdf',
      Buffer.from('%PDF-synthetic'),
    );
    const file = await fixture.prisma.submissionFile.findFirstOrThrow({
      where: { applicationId: flowIds.application },
    });
    await fixture.submit('첫 제출', file.id);

    // When
    expect((await fixture.submit('이번 제출은 글만 포함합니다.')).status).toBe(
      201,
    );

    // Then
    expect(
      (
        await fixture.request(
          `${fixture.documentPath()}/submissions/current/file`,
        )
      ).status,
    ).toBe(404);
    const stored = await fixture.prisma.submissionFile.findUniqueOrThrow({
      where: { id: file.id },
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
