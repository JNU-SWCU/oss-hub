import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { archiveEntries } from './milestone-document-archive.fixture';
import {
  archiveId,
  ProgramArchiveIntegrationFixture,
  retainedImage,
} from './milestone-document-archive.integration-fixture';
import type { ProgramDocumentArchiveScope } from './milestone-document-archive.service';
import { startArchiveHttp } from './milestone-document-archive.http-fixture';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});
const fixture = new ProgramArchiveIntegrationFixture();
let http: Awaited<ReturnType<typeof startArchiveHttp>>;
beforeAll(async () => {
  await fixture.seed();
  http = await startArchiveHttp(fixture);
});
afterAll(async () => {
  await http?.close();
  await fixture.stop();
});
async function download(scope: ProgramDocumentArchiveScope) {
  const response = await http.request(scope);
  expect(response.status).toBe(200);
  const bytes = Buffer.from(await response.arrayBuffer());
  expect(bytes.length).toBe(Number(response.headers.get('content-length')));
  return archiveEntries(bytes);
}

it('PROGRAM uses real approved-program participation and exports only latest text/file revisions', async () => {
  const entries = await download({ kind: 'PROGRAM' });
  const manifest = entries[0]?.body.toString('utf8');
  expect(manifest).toContain('합성 팀 0');
  expect(manifest).toContain('합성 팀 1');
  expect(manifest).not.toContain('합성 팀 2');
  expect(manifest).not.toContain('합성 팀 3');
  expect(manifest).not.toContain('숨긴 레거시');
  expect(manifest).toContain('반려');
  expect(manifest).toContain('보완 요청');
  expect(manifest).toContain('승인');
  expect(manifest).toContain('미제출');
  expect(entries.filter((entry) => entry.name.endsWith('.txt'))).toHaveLength(
    3,
  );
  expect(entries.find((entry) => entry.name.endsWith('.png'))?.body).toEqual(
    retainedImage,
  );
  expect(entries.some((entry) => entry.name.endsWith('.pdf'))).toBe(false);
  const content = entries
    .map((entry) => entry.body.toString('utf8'))
    .join('\n');
  expect(content).not.toContain('previous-revision-must-not-export');
  expect(content).not.toContain('current-2-a1');
  expect(content).not.toContain('current-3-b1');
});

it('TEAM means one selected team over all milestones in the same program', async () => {
  const entries = await download({ kind: 'TEAM', teamId: archiveId('team-0') });
  expect(
    entries
      .filter((entry) => entry.name.endsWith('.txt'))
      .map((entry) => entry.body.toString('utf8')),
  ).toEqual(['current-0-a1', 'current-0-a2']);
  expect(entries[0]?.body.toString('utf8')).not.toContain('합성 팀 1');
});

it('MILESTONE scopes actual rows and preserves other team current submissions', async () => {
  const entries = await download({
    kind: 'MILESTONE',
    milestoneId: archiveId('a1'),
  });
  expect(
    entries
      .filter((entry) => entry.name.endsWith('.txt'))
      .map((entry) => entry.body.toString('utf8')),
  ).toEqual(['current-0-a1', 'current-1-a1']);
});

it.each(['team-2', 'team-3', 'missing'])(
  'rejects unapproved/cross-program/nonexistent team %s before returning a ZIP',
  async (team) => {
    const response = await http.request({
      kind: 'TEAM',
      teamId: archiveId(team),
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      code: 'MSD_036',
      status: 404,
    });
  },
);

it('rejects a milestone from the other program', async () => {
  const response = await http.request({
    kind: 'MILESTONE',
    milestoneId: archiveId('b1'),
  });
  expect(response.status).toBe(404);
  expect(await response.json()).toMatchObject({ code: 'MSD_003', status: 404 });
});

it('requires authenticated active staff on the real endpoint', async () => {
  expect((await http.request({ kind: 'PROGRAM' }, false)).status).toBe(401);
  await fixture.prisma.user.update({
    where: { id: archiveId('user') },
    data: { hasStaffAccess: false },
  });
  try {
    expect((await http.request({ kind: 'PROGRAM' })).status).toBe(403);
  } finally {
    await fixture.prisma.user.update({
      where: { id: archiveId('user') },
      data: { hasStaffAccess: true },
    });
  }
});

it('returns 404 for a nonexistent program on the real endpoint', async () => {
  const response = await http.request(
    { kind: 'PROGRAM' },
    true,
    archiveId('missing'),
  );
  expect(response.status).toBe(404);
  expect(await response.json()).toMatchObject({ code: 'MSD_035' });
});

it.each(['ATTACHED', 'DELETE_PENDING', 'DELETED'] as const)(
  'reports unavailable current attachment (%s) without falling back to an older revision',
  async (lifecycle) => {
    await fixture.prisma.submissionFile.update({
      where: { id: archiveId('file-a1-2') },
      data: {
        lifecycle,
        expiresAt: new Date('2026-01-01'),
        deletedAt: lifecycle === 'DELETED' ? new Date('2026-01-02') : null,
      },
    });
    try {
      const entries = await download({
        kind: 'TEAM',
        teamId: archiveId('team-0'),
      });
      expect(entries.some((entry) => /\.(png|pdf)$/.test(entry.name))).toBe(
        false,
      );
      expect(
        entries.filter((entry) => entry.name.endsWith('.txt')),
      ).toHaveLength(2);
      expect(entries[0]?.body.toString('utf8')).toContain(
        '첨부를 가져올 수 없음',
      );
      expect(entries[0]?.body.toString('utf8')).not.toContain('보존 기한');
    } finally {
      await fixture.prisma.submissionFile.update({
        where: { id: archiveId('file-a1-2') },
        data: {
          lifecycle: 'ATTACHED',
          expiresAt: new Date('2099-12-31'),
          deletedAt: null,
        },
      });
    }
  },
);
