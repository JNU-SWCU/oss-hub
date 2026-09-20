import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { Test } from '@nestjs/testing';
import { ProgramCoverController } from './controller/program-cover.controller';
import { ProgramCoverService } from './service/program-cover.service';
import { ProgramCoverRepository } from './repository/program-cover.repository';
import { SUBMISSION_FILE_STORAGE } from '../submissions/submission-file-storage.port';
import { ProgramListPageResponseDto } from './dto/program-list-response.dto';
import { ProgramsRepository } from './repository/programs.repository';
import { ProgramsService } from './service/programs.service';
import {
  GITHUB_ID,
  PREFIX,
  prisma,
  editor,
  publicCovers,
  request,
  seedUpload,
  authoring,
} from './program-cover.integration-fixtures';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const externalCover = {
  sourceUrl: 'https://sojoong.kr/notice/notice-board/?uid=123&mod=document',
  imageUrl: 'https://sojoong.kr/wp-content/uploads/2026/09/synthetic.jpg',
};

it('returns the same public-cover HTTP 404 for an external reference and a missing cover without reading storage', async () => {
  const program = await authoring().create(GITHUB_ID, 'external-route', {
    ...request(),
    externalCover,
  });
  const cover = await prisma.programCover.findUniqueOrThrow({
    where: { programId: program.id },
  });
  const get = jest.fn();
  const moduleRef = await Test.createTestingModule({
    controllers: [ProgramCoverController],
    providers: [
      ProgramCoverService,
      { provide: ProgramCoverRepository, useValue: publicCovers },
      { provide: SUBMISSION_FILE_STORAGE, useValue: { get } },
    ],
  }).compile();
  const application = moduleRef.createNestApplication();
  await application.listen(0, '127.0.0.1');
  try {
    const url = `${await application.getUrl()}/programs/${program.id}/cover/`;
    const response = await fetch(`${url}${cover.id}`);
    const missing = await fetch(`${url}missing`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual(await missing.json());
    expect(get).not.toHaveBeenCalled();
  } finally {
    await application.close();
  }
});

it('creates and replays an external cover with public projections and no storage ownership', async () => {
  const input = { ...request(), externalCover };
  const program = await authoring().create(GITHUB_ID, 'external-create', input);
  const cover = await prisma.programCover.findUniqueOrThrow({
    where: { programId: program.id },
  });
  expect(cover).toMatchObject({
    source: 'EXTERNAL',
    storageKey: null,
    mimeType: null,
    sizeBytes: null,
    ...externalCover,
  });
  expect(
    (await authoring().create(GITHUB_ID, 'external-create', input)).id,
  ).toBe(program.id);
  await expect(
    authoring().create(GITHUB_ID, 'external-create', {
      ...input,
      externalCover: {
        ...externalCover,
        imageUrl: externalCover.imageUrl.replace('synthetic', 'changed'),
      },
    }),
  ).rejects.toThrow('idempotency key');
  expect(
    await prisma.programAuthoringUpload.count({
      where: { actorId: { startsWith: PREFIX } },
    }),
  ).toBe(0);
  const programs = new ProgramsService(new ProgramsRepository(prisma));
  const listing = await programs.list({
    page: 1,
    pageSize: 20,
    search: PREFIX,
    status: 'all',
  });
  expect(ProgramListPageResponseDto.from(listing).items[0]?.coverImageUrl).toBe(
    externalCover.imageUrl,
  );
  const detail = await programs.detail(program.id, {
    githubId: null,
    userId: null,
    role: null,
  });
  expect(detail.coverImageUrl).toBe(externalCover.imageUrl);
  expect(detail).not.toHaveProperty('sourceUrl');
  expect(await editor.getProgram(GITHUB_ID, program.id)).toMatchObject({
    coverImageUrl: externalCover.imageUrl,
    externalCover,
  });
  await expect(
    publicCovers.findPublicCover(program.id, cover.id),
  ).resolves.toBeNull();
});

it.each(['owned', 'external', 'none'] as const)(
  'replaces %s with an external cover, tombstoning only an owned object',
  async (previous) => {
    const upload = previous === 'owned' ? await seedUpload() : null;
    const program = await authoring().create(GITHUB_ID, 'replace-external', {
      ...request(),
      ...(upload
        ? { coverUploadId: upload.id }
        : previous === 'external'
          ? { externalCover }
          : {}),
    });
    const next = {
      ...externalCover,
      imageUrl: externalCover.imageUrl.replace('synthetic', 'next'),
    };
    await editor.updateProgram(GITHUB_ID, program.id, {
      ...request(),
      externalCover: next,
    });
    expect(
      await prisma.programCover.findUnique({
        where: { programId: program.id },
      }),
    ).toMatchObject({ source: 'EXTERNAL', ...next });
    const tombstones = await prisma.programPurgeFileTombstone.findMany({
      where: { storageKey: { contains: PREFIX } },
    });
    expect(tombstones.map(({ storageKey }) => storageKey)).toEqual(
      upload ? [upload.storageKey] : [],
    );
  },
);

it('retains an external cover when edit omits both choices', async () => {
  const program = await authoring().create(GITHUB_ID, 'retain-external', {
    ...request(),
    externalCover,
  });
  await editor.updateProgram(GITHUB_ID, program.id, request());
  expect(await editor.getProgram(GITHUB_ID, program.id)).toMatchObject({
    externalCover,
  });
});

it.each(['owned', 'remove-external', 'remove-upload'] as const)(
  'changes an external cover to %s without deleting any remote object',
  async (next) => {
    const program = await authoring().create(GITHUB_ID, 'remove-external', {
      ...request(),
      externalCover,
    });
    const upload = next === 'owned' ? await seedUpload() : null;
    const choice = upload
      ? { coverUploadId: upload.id }
      : next === 'remove-external'
        ? { externalCover: null }
        : { coverUploadId: null };
    await editor.updateProgram(GITHUB_ID, program.id, {
      ...request(),
      ...choice,
    });
    const cover = await prisma.programCover.findUnique({
      where: { programId: program.id },
    });
    if (upload)
      expect(cover).toMatchObject({
        source: 'OWNED',
        storageKey: upload.storageKey,
        sourceUrl: null,
        imageUrl: null,
      });
    else expect(cover).toBeNull();
    expect(
      await prisma.programPurgeFileTombstone.count({
        where: { storageKey: { contains: PREFIX } },
      }),
    ).toBe(0);
  },
);

it.each([
  {
    sourceUrl: 'https://attacker.example/notice',
    imageUrl: externalCover.imageUrl,
  },
  {
    sourceUrl: externalCover.sourceUrl,
    imageUrl: 'https://attacker.example/cover.jpg',
  },
  {
    sourceUrl: externalCover.sourceUrl,
    imageUrl: 'http://127.0.0.1/cover.jpg',
  },
])(
  'rejects untrusted references at create and edit without prior preview',
  async (invalid) => {
    await expect(
      authoring().create(GITHUB_ID, 'invalid-external', {
        ...request(),
        externalCover: invalid,
      }),
    ).rejects.toThrow();
    expect(
      await prisma.program.count({ where: { name: { startsWith: PREFIX } } }),
    ).toBe(0);
    const program = await authoring().create(GITHUB_ID, 'before-invalid-edit', {
      ...request(),
      externalCover,
    });
    await expect(
      editor.updateProgram(GITHUB_ID, program.id, {
        ...request(),
        externalCover: invalid,
      }),
    ).rejects.toThrow();
    expect(await editor.getProgram(GITHUB_ID, program.id)).toMatchObject({
      externalCover,
    });
  },
);

it('enforces source-state constraints and preserves default owned rows', async () => {
  const program = await authoring().create(
    GITHUB_ID,
    'constraint-external',
    request(),
  );
  await expect(
    prisma.programCover.create({
      data: {
        programId: program.id,
        source: 'EXTERNAL',
        ...externalCover,
        storageKey: 'program-covers/invalid',
      },
    }),
  ).rejects.toThrow();
  await expect(
    prisma.programCover.create({
      data: { programId: program.id, source: 'OWNED' },
    }),
  ).rejects.toThrow();
  const cover = await prisma.programCover.create({
    data: {
      programId: program.id,
      storageKey: 'program-covers/legacy',
      mimeType: 'image/png',
      sizeBytes: 68,
    },
  });
  expect(cover.source).toBe('OWNED');
});
