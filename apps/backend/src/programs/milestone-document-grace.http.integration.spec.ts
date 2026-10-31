import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import {
  MilestoneDocumentFlowFixture,
  flowIds,
} from './milestone-document-flow.integration-fixture';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});
const fixture = new MilestoneDocumentFlowFixture();
const graceDueAt = '2099-06-30T23:59:00+09:00';
const setGrace = (value: string | null, actor: 'student' | 'staff' = 'staff') =>
  fixture.request(`${fixture.documentPath()}/grace`, {
    actor,
    method: 'PATCH',
    json: { graceDueAt: value },
  });

async function upload(): Promise<Response> {
  const body = new FormData();
  body.append('milestoneId', flowIds.milestone);
  body.append('documentId', flowIds.document);
  body.append(
    'file',
    new Blob([new TextEncoder().encode('%PDF-1.7\nsynthetic')], {
      type: 'application/pdf',
    }),
    'synthetic.pdf',
  );
  return fixture.request('milestone-document-files', { method: 'POST', body });
}

async function listedDocument() {
  const response = await fixture.request(
    `milestones/${flowIds.milestone}/documents`,
  );
  expect(response.status).toBe(200);
  return response.json() as Promise<{
    documents: {
      graceDueAt: string | null;
      viewerSubmission: { submittedLate: boolean; revision: number | null };
    }[];
  }>;
}

describe('per-document grace HTTP + PostgreSQL', () => {
  beforeAll(() => fixture.start());
  beforeEach(() => fixture.reset());
  afterAll(() => fixture.stop());

  it.each([
    ['2029-02-28T08:59:59.999Z', 204],
    ['2029-02-28T09:00:00.000Z', 422],
    ['2029-02-28T09:00:00.001Z', 422],
    ['2029-03-01T09:00:00.000Z', 422],
  ] as const)(
    'validates leap-year file retention at %s',
    async (value, status) => {
      await fixture.prisma.program.update({
        where: { id: flowIds.program },
        data: { endAt: new Date('2028-02-29T09:00:00Z') },
      });
      await fixture.closeDeadline();
      const response = await setGrace(value);
      expect(response.status).toBe(status);
      await expect(
        fixture.prisma.milestoneDocument.findUnique({
          where: { id: flowIds.document },
          select: { graceDueAt: true },
        }),
      ).resolves.toEqual({
        graceDueAt: status === 204 ? new Date(value) : null,
      });
    },
  );
  it('기존 문서는 유예가 없고 학생이 기한을 설정할 수 없다', async () => {
    expect((await listedDocument()).documents[0]?.graceDueAt).toBeNull();
    expect((await setGrace(graceDueAt, 'student')).status).toBe(403);
    await fixture.closeDeadline();
    expect((await fixture.submit('마감 후 최초')).status).toBe(422);
    expect((await upload()).status).toBe(422);
  });

  it.each(['2099-06-30T23:59', 'invalid', '2099-02-30T23:59:00Z'])(
    '시각대가 없거나 잘못된 날짜를 거절한다: %s',
    async (value) => {
      expect((await setGrace(value)).status).toBe(400);
    },
  );

  it('날짜 누락은 해제로 해석하지 않고 마감 이전/동일 시각을 거절한다', async () => {
    expect(
      (
        await fixture.request(`${fixture.documentPath()}/grace`, {
          actor: 'staff',
          method: 'PATCH',
          json: {},
        })
      ).status,
    ).toBe(400);
    for (const value of ['2098-12-31T23:59:59Z', '2099-01-01T00:00:00Z']) {
      const response = await setGrace(value);
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ code: 'MSD_045' });
    }
  });

  it('유예 중 첫 파일 제출과 교체를 받고 원래 마감 기준 지각 표시를 반환한다', async () => {
    expect((await setGrace(graceDueAt)).status).toBe(204);
    await fixture.closeDeadline();
    const uploaded = await upload();
    expect(uploaded.status).toBe(201);
    const { fileId } = (await uploaded.json()) as { fileId: string };
    expect((await fixture.submit('유예 첫 제출', fileId)).status).toBe(201);
    expect((await fixture.submit('유예 중 교체')).status).toBe(201);
    expect((await listedDocument()).documents[0]).toMatchObject({
      graceDueAt: '2099-06-30T14:59:00.000Z',
      viewerSubmission: { submittedLate: true, revision: 2 },
    });
  });

  it('마감 전에 낸 서류는 유예 설정 여부와 관계없이 지각이 아니다', async () => {
    expect((await setGrace(graceDueAt)).status).toBe(204);
    expect((await fixture.submit('정시 제출')).status).toBe(201);
    expect(
      (await listedDocument()).documents[0]?.viewerSubmission.submittedLate,
    ).toBe(false);
  });

  it('업로드 후 유예를 해제하면 최종 제출과 새 업로드를 다시 막는다', async () => {
    await fixture.closeDeadline();
    expect((await setGrace(graceDueAt)).status).toBe(204);
    const uploaded = await upload();
    expect(uploaded.status).toBe(201);
    const { fileId } = (await uploaded.json()) as { fileId: string };
    expect((await setGrace(null)).status).toBe(204);
    expect((await fixture.submit('이미 올려 둔 파일', fileId)).status).toBe(
      422,
    );
    expect((await upload()).status).toBe(422);
    expect(
      await fixture.prisma.milestoneDocumentSubmission.count({
        where: { milestoneDocumentId: flowIds.document },
      }),
    ).toBe(0);
  });

  it('유예를 이미 지난 시각으로 줄이면 교체를 막고 저장된 버전을 유지한다', async () => {
    await fixture.closeDeadline();
    expect((await setGrace(graceDueAt)).status).toBe(204);
    expect((await fixture.submit('기존 제출')).status).toBe(201);
    expect((await setGrace('2002-01-01T00:00:00Z')).status).toBe(204);
    expect((await fixture.submit('기한 이후 교체')).status).toBe(422);
    expect(
      (await listedDocument()).documents[0]?.viewerSubmission.revision,
    ).toBe(1);
  });
});
