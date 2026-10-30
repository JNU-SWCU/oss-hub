import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import {
  authoring,
  editor,
  GITHUB_ID,
  prisma,
  request,
  seedUpload,
} from './program-cover.integration-fixtures';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

it('allows exactly one program to consume a pending cover across concurrent saves', async () => {
  const first = await authoring().create(GITHUB_ID, 'first', request());
  const second = await authoring().create(GITHUB_ID, 'second', request());
  const upload = await seedUpload();
  const input = { ...request(), coverUploadId: upload.id };
  const saves = await Promise.allSettled([
    editor.updateProgram(GITHUB_ID, first.id, input),
    editor.updateProgram(GITHUB_ID, second.id, input),
  ]);
  expect(saves.map(({ status }) => status).sort()).toEqual([
    'fulfilled',
    'rejected',
  ]);
  expect(
    await prisma.programCover.count({
      where: { programId: { in: [first.id, second.id] } },
    }),
  ).toBe(1);
  expect(
    await prisma.programAuthoringUpload.findUnique({
      where: { id: upload.id },
    }),
  ).toBeNull();
});

it('enforces one cover per program independently of service validation', async () => {
  const upload = await seedUpload();
  const program = await authoring().create(GITHUB_ID, 'unique', {
    ...request(),
    coverUploadId: upload.id,
  });
  await expect(
    prisma.programCover.create({
      data: {
        programId: program.id,
        storageKey: 'program-covers/another-image',
        mimeType: 'image/png',
        sizeBytes: 68,
      },
    }),
  ).rejects.toMatchObject({ code: 'P2002' });
});
