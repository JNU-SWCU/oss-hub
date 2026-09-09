import { createHash } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import {
  list,
  record,
  text as apiText,
  parseProgram,
  parseTeams,
} from './program-authoring-archive-contracts';
import {
  downloadScope,
  type Scope,
  type Grouping,
} from './program-authoring-archive-download';
import { expectApiStatus, writeArtifact } from './program-authoring-flow';
import { originHeaders } from './program-authoring-ui';
import { zipEntries } from './program-authoring-zip';
import { archiveFixtureDocument } from './program-authoring-archive-fixture';

type CurrentPayload = {
  readonly milestoneId: string;
  readonly teamId: string;
  readonly text: string;
  readonly file: Buffer;
};
/** Runs after the existing two-milestone/two-approved-team flow has asserted its original receipts. */
export async function verifyProgramArchiveScopes(input: {
  readonly programId: string;
  readonly staffPage: Page;
  readonly studentPage: Page;
  readonly foreignStudentPage: Page;
}): Promise<void> {
  const { programId, staffPage, studentPage, foreignStudentPage } = input;
  const path = `/api/v1/programs/${encodeURIComponent(programId)}`;
  const programResponse = await staffPage.request.get(`${path}/viewer`);
  await expectApiStatus(programResponse, 200);
  const program = parseProgram(await programResponse.json());
  const teamsResponse = await staffPage.request.get(`${path}/teams`);
  await expectApiStatus(teamsResponse, 200);
  const teams = parseTeams(await teamsResponse.json());
  expect(program.milestones).toHaveLength(2);
  expect(teams).toHaveLength(2);
  const actors = [
    { page: studentPage, nickname: 'e2e-program-authoring-student' },
    {
      page: foreignStudentPage,
      nickname: 'e2e-program-authoring-foreign-student',
    },
  ];
  const current: CurrentPayload[] = [];
  for (const [stageIndex, milestone] of program.milestones.entries()) {
    const document = await archiveFixtureDocument(staffPage, milestone.id);
    for (const [actorIndex, actor] of actors.entries()) {
      const team = teams.find((item) =>
        item.members.some((member) => member.nickname === actor.nickname),
      );
      if (team === undefined)
        throw new Error(
          `Missing approved synthetic actor team: ${actor.nickname}`,
        );
      const text = `e2e:archive-current:stage-${stageIndex}:team-${actorIndex}`;
      const file = Buffer.from(`%PDF-1.4\n${text}\n`);
      const upload = await actor.page.request.post(
        '/api/v1/milestone-document-files',
        {
          headers: originHeaders(),
          multipart: {
            milestoneId: milestone.id,
            documentId: document.id,
            file: {
              name: `scope-${stageIndex}-${actorIndex}.pdf`,
              mimeType: 'application/pdf',
              buffer: file,
            },
          },
        },
      );
      await expectApiStatus(upload, 201);
      const fileId = apiText(record(await upload.json()).fileId);
      const submission = await actor.page.request.post(
        `/api/v1/milestones/${milestone.id}/documents/${document.id}/submissions`,
        { headers: originHeaders(), data: { content: { text, fileId } } },
      );
      await expectApiStatus(submission, 201);
      current.push({
        milestoneId: milestone.id,
        teamId: team.teamId,
        text,
        file,
      });
    }
  }
  await staffPage.goto(`/programs/${encodeURIComponent(programId)}/documents`);
  await staffPage
    .getByPlaceholder('신청자·팀명·GitHub ID')
    .fill('synthetic-no-team-matches-archive');
  const [matrix] = await Promise.all([
    staffPage.waitForResponse(
      (response) =>
        response.url().includes('/submissions/matrix?') &&
        response.url().includes('synthetic-no-team-matches-archive'),
    ),
    staffPage.getByRole('button', { name: '조회', exact: true }).click(),
  ]);
  expect(matrix.status()).toBe(200);
  expect(list(record(await matrix.json()).rows)).toHaveLength(0);
  const panel = staffPage.getByTestId('program-document-archive');
  await panel.getByRole('button', { name: '제출 자료 ZIP 내려받기' }).click();
  await expect(
    panel.getByTestId('program-document-archive-summary'),
  ).toContainText(program.name);
  const stage = program.milestones[0];
  const team = teams[0];
  if (stage === undefined || team === undefined)
    throw new Error('Archive scope fixture is incomplete.');
  const cases: readonly { scope: Scope; grouping: Grouping }[] = [
    { scope: { kind: 'PROGRAM' }, grouping: 'TEAM' },
    { scope: { kind: 'MILESTONE', milestoneId: stage.id }, grouping: 'TEAM' },
    { scope: { kind: 'TEAM', teamId: team.teamId }, grouping: 'DOCUMENT' },
    { scope: { kind: 'PROGRAM' }, grouping: 'DOCUMENT' },
  ];
  const receipts = [];
  for (const item of cases) {
    const included = current.filter(
      (payload) =>
        item.scope.kind === 'PROGRAM' ||
        (item.scope.kind === 'MILESTONE'
          ? payload.milestoneId === item.scope.milestoneId
          : payload.teamId === item.scope.teamId),
    );
    const archive = await downloadScope(staffPage, item.scope, item.grouping);
    const entries = zipEntries(archive.bytes);
    expect(entries.some((entry) => entry.path === '제출현황.csv')).toBe(true);
    for (const payload of current) {
      const expectedCount = included.includes(payload) ? 1 : 0;
      expect(
        entries.filter((entry) => entry.bytes.equals(payload.file)),
      ).toHaveLength(expectedCount);
      expect(
        entries.filter(
          (entry) =>
            entry.path.endsWith('.txt') &&
            entry.bytes.toString('utf8') === payload.text,
        ),
      ).toHaveLength(expectedCount);
    }
    const allText = entries
      .map((entry) => entry.bytes.toString('utf8'))
      .join('\n');
    expect(allText).not.toContain('e2e:program-authoring:revision-1-text-only');
    expect(allText).not.toContain(
      'e2e:program-authoring:revision-2-text-and-file',
    );
    expect(entries.filter((entry) => entry.path.endsWith('.pdf'))).toHaveLength(
      included.length,
    );
    expect(entries.filter((entry) => entry.path.endsWith('.txt'))).toHaveLength(
      included.length,
    );
    receipts.push({
      ...item,
      request: archive.request,
      name: archive.name,
      sha256: hash(archive.bytes),
      size: archive.bytes.length,
      entries: entries.map((entry) => ({
        path: entry.path,
        size: entry.bytes.length,
        sha256: hash(entry.bytes),
      })),
    });
  }
  const teamLayout = receipts[0];
  const documentLayout = receipts[3];
  if (teamLayout === undefined || documentLayout === undefined)
    throw new Error('Grouping receipts are missing.');
  const firstPayload = current[0];
  if (firstPayload === undefined)
    throw new Error('Current archive payload is missing.');
  const payloadHash = hash(firstPayload.file);
  const teamFile = teamLayout.entries.find(
    (entry) => entry.sha256 === payloadHash,
  );
  const documentFile = documentLayout.entries.find(
    (entry) => entry.sha256 === payloadHash,
  );
  expect(teamFile?.path.split('/')[0]).not.toBe(
    documentFile?.path.split('/')[0],
  );
  expect(
    teamLayout.entries
      .filter((entry) => entry.path !== '제출현황.csv')
      .map((entry) => entry.sha256)
      .sort(),
  ).toEqual(
    documentLayout.entries
      .filter((entry) => entry.path !== '제출현황.csv')
      .map((entry) => entry.sha256)
      .sort(),
  );
  await writeArtifact('program-archive-scopes.json', {
    programId,
    synthetic: true,
    setup:
      'Existing adopted two-stage/two-approved-team graph; current fingerprint PATCH adds one item only in the empty stage, then public file upload/submission APIs',
    filteredMatrixRowCount: 0,
    currentPayloads: current.map(({ file, ...payload }) => ({
      ...payload,
      fileSha256: hash(file),
    })),
    receipts,
  });
}

function hash(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}
