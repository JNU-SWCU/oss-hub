import { ProgramLifecycle } from '@prisma/client';
import { ProgramsRepository } from './repository/programs.repository';
import { ProgramsService } from './service/programs.service';
import { ProgramListPageResponseDto } from './dto/program-list-response.dto';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { replaceProgramCover } from './repository/program-cover-write';
import { programCoverImageUrl } from './program-cover';
import {
  ACTOR,
  GITHUB_ID,
  PREFIX,
  prisma,
  editor,
  publicCovers,
  record,
  request,
  seedUpload,
  authoring,
} from './program-cover.integration-fixtures';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

it('attaches one cover only on create and preserves idempotent replay after consuming its token', async () => {
  const token = await seedUpload();
  const input = { ...request(), coverUploadId: token.id };
  const created = await authoring().create(GITHUB_ID, 'create-cover', input);
  const cover = await prisma.programCover.findUniqueOrThrow({
    where: { programId: created.id },
  });
  expect(
    await prisma.programAuthoringUpload.findUnique({ where: { id: token.id } }),
  ).toBeNull();
  expect((await authoring().create(GITHUB_ID, 'create-cover', input)).id).toBe(
    created.id,
  );
  await expect(
    authoring().create(GITHUB_ID, 'create-cover', {
      ...input,
      coverUploadId: 'different-token',
    }),
  ).rejects.toThrow('idempotency key');
  expect((await editor.getProgram(GITHUB_ID, created.id)).coverImageUrl).toBe(
    programCoverImageUrl(created.id, cover.id),
  );
  const programs = new ProgramsService(new ProgramsRepository(prisma));
  const listing = await programs.list({
    page: 1,
    pageSize: 20,
    search: PREFIX,
    status: 'all',
  });
  expect(ProgramListPageResponseDto.from(listing).items[0]?.coverImageUrl).toBe(
    programCoverImageUrl(created.id, cover.id),
  );
  const detail = await programs.detail(created.id, {
    githubId: null,
    userId: null,
    role: null,
  });
  expect(detail.coverImageUrl).toBe(programCoverImageUrl(created.id, cover.id));
  expect(detail).not.toHaveProperty('storageKey');
  await expect(
    publicCovers.findPublicCover(created.id, cover.id),
  ).resolves.toEqual({
    storageKey: token.storageKey,
    mimeType: 'image/png',
    sizeBytes: 68,
  });
  await expect(
    publicCovers.findPublicCover('other-program', cover.id),
  ).resolves.toBeNull();
  await prisma.program.update({
    where: { id: created.id },
    data: { lifecycle: ProgramLifecycle.ARCHIVED },
  });
  await expect(
    publicCovers.findPublicCover(created.id, cover.id),
  ).resolves.not.toBeNull();
});

it('rolls back cover attachment and token consumption if the rest of create fails', async () => {
  const token = await seedUpload();
  record.mockRejectedValueOnce(new Error('synthetic save failure'));
  await expect(
    authoring().create(GITHUB_ID, 'failed-create', {
      ...request(),
      coverUploadId: token.id,
    }),
  ).rejects.toThrow('synthetic save failure');
  expect(await prisma.program.count({ where: { name: request().name } })).toBe(
    0,
  );
  expect(
    await prisma.programCover.count({
      where: { program: { name: { startsWith: PREFIX } } },
    }),
  ).toBe(0);
  expect(
    (
      await prisma.programAuthoringUpload.findUniqueOrThrow({
        where: { id: token.id },
      })
    ).lifecycle,
  ).toBe('PENDING');
});

it('preserves omitted covers, atomically replaces/removes them, and immediately hides old URLs', async () => {
  const first = await seedUpload();
  const program = await authoring().create(GITHUB_ID, 'edit-cover', {
    ...request(),
    coverUploadId: first.id,
  });
  const oldCover = await prisma.programCover.findUniqueOrThrow({
    where: { programId: program.id },
  });
  await editor.updateProgram(GITHUB_ID, program.id, request());
  expect(
    (
      await prisma.programCover.findUniqueOrThrow({
        where: { programId: program.id },
      })
    ).id,
  ).toBe(oldCover.id);
  const second = await seedUpload();
  const changed = await editor.updateProgram(GITHUB_ID, program.id, {
    ...request(),
    coverUploadId: second.id,
  });
  expect(changed.coverImageUrl).not.toBe(
    programCoverImageUrl(program.id, oldCover.id),
  );
  expect(
    await publicCovers.findPublicCover(program.id, oldCover.id),
  ).toBeNull();
  expect(
    await prisma.programPurgeFileTombstone.count({
      where: { storageKey: first.storageKey },
    }),
  ).toBe(1);
  expect(
    (
      await editor.updateProgram(GITHUB_ID, program.id, {
        ...request(),
        coverUploadId: null,
      })
    ).coverImageUrl,
  ).toBeNull();
  expect(
    await prisma.programCover.findUnique({ where: { programId: program.id } }),
  ).toBeNull();
  expect(
    await prisma.programPurgeFileTombstone.count({
      where: { storageKey: second.storageKey },
    }),
  ).toBe(1);
});

it.each(['replace', 'remove'])(
  'retains old cover after an in-transaction %s failure',
  async (operation) => {
    const first = await seedUpload();
    const program = await authoring().create(GITHUB_ID, 'rollback-cover', {
      ...request(),
      coverUploadId: first.id,
    });
    const oldCover = await prisma.programCover.findUniqueOrThrow({
      where: { programId: program.id },
    });
    const second = await seedUpload();
    await expect(
      prisma.$transaction(async (transaction) => {
        await replaceProgramCover(transaction, {
          programId: program.id,
          actorId: ACTOR,
          uploadId: operation === 'replace' ? second.id : null,
        });
        throw new Error('synthetic save failure');
      }),
    ).rejects.toThrow('synthetic save failure');
    expect(
      (
        await prisma.programCover.findUniqueOrThrow({
          where: { programId: program.id },
        })
      ).id,
    ).toBe(oldCover.id);
    expect(
      await prisma.programPurgeFileTombstone.count({
        where: { storageKey: first.storageKey },
      }),
    ).toBe(0);
    expect(
      (
        await prisma.programAuthoringUpload.findUniqueOrThrow({
          where: { id: second.id },
        })
      ).lifecycle,
    ).toBe('PENDING');
  },
);

it.each(['foreign', 'expired', 'document'])(
  'rejects %s cover tokens before any saved change',
  async (kind) => {
    const other = `${PREFIX}other`;
    await prisma.user.create({
      data: {
        id: other,
        githubId: GITHUB_ID + 1n,
        nickname: 'synthetic-other',
      },
    });
    const token = await seedUpload(
      kind === 'document' ? 'program-authoring/' : 'program-covers/',
      kind === 'foreign' ? other : ACTOR,
      kind === 'expired' ? new Date(0) : new Date('2099-01-01'),
    );
    await expect(
      authoring().create(GITHUB_ID, 'invalid-cover', {
        ...request(),
        coverUploadId: token.id,
      }),
    ).rejects.toThrow('not attachable');
    expect(
      await prisma.program.count({ where: { name: request().name } }),
    ).toBe(0);
  },
);

it.each([
  { storageKey: 'program-authoring/private-document' },
  { mimeType: 'text/html' },
  { sizeBytes: 0 },
  { sizeBytes: 5242881 },
])('enforces the migration cover safety constraint for %j', async (invalid) => {
  const program = await authoring().create(GITHUB_ID, 'constraint', request());
  await expect(
    prisma.programCover.create({
      data: {
        programId: program.id,
        storageKey: `program-covers/${PREFIX}constraint`,
        mimeType: 'image/png',
        sizeBytes: 68,
        ...invalid,
      },
    }),
  ).rejects.toThrow();
});
