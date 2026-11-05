import { ProgramScheduleService } from './program-schedule.service';
import { ProgramTemplatesService } from './team-application.service';
import { STATELESS_PROVIDERS } from '../../test/stateless-providers.fixture';
import { ProgramViewerService } from './program-viewer.service';
import { ProgramListStatusFilterRepository } from './program-list-status-filter.repository';
import { PlatformRepository } from '../platform/platform.repository';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { Test } from '@nestjs/testing';
import { ProgramsController } from './programs.controller';
import { ProgramCoverService } from './program-creation.service';
import { ProgramCoverRepository } from './files.repository';
import { OBJECT_STORAGE } from '../platform/object-storage.config';
import { ProgramListPageResponseDto } from './dto/program-list-response.dto';
import { ProgramsRepository } from './programs.repository';
import { ProgramsService } from './programs.service';
import {
  COVER_ACTOR,
  GITHUB_ID,
  PREFIX,
  prisma,
  editor,
  publicCovers,
  request,
  seedUpload,
  authoring,
} from './program-cover.integration-fixtures';
import { MilestoneCompletionService } from './milestone-completion.service';
import { ProgramCoverUrlService } from './program-cover-url.service';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const externalCover = {
  sourceUrl: 'https://sojoong.kr/notice/notice-board/?uid=123&mod=document',
  imageUrl: 'https://sojoong.kr/wp-content/uploads/2026/09/synthetic.jpg',
};

it('returns the same public-cover HTTP 404 for an external reference and a missing cover without reading storage', async () => {
  const program = await authoring().create(COVER_ACTOR, 'external-route', {
    ...request(),
    externalCover,
  });
  expect(await prisma.file.count({ where: { programId: program.id } })).toBe(0);
  const get = jest.fn();
  const moduleRef = await Test.createTestingModule({
    controllers: [ProgramsController],
    providers: [
      ...STATELESS_PROVIDERS,
      ProgramCoverRepository,
      ProgramCoverService,
      { provide: ProgramCoverRepository, useValue: publicCovers },
      { provide: OBJECT_STORAGE, useValue: { get } },
    ],
  })
    .useMocker((token) => (token === Function ? undefined : {}))
    .compile();
  const application = moduleRef.createNestApplication();
  await application.listen(0, '127.0.0.1');
  try {
    const url = `${await application.getUrl()}/programs/${program.id}/cover/`;
    const response = await fetch(`${url}${program.id}`);
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
  const program = await authoring().create(
    COVER_ACTOR,
    'external-create',
    input,
  );
  const cover = await prisma.program.findUniqueOrThrow({
    where: { id: program.id },
    select: { coverFileId: true, coverSourceUrl: true, coverImageUrl: true },
  });
  expect(cover).toEqual({
    coverFileId: null,
    coverSourceUrl: externalCover.sourceUrl,
    coverImageUrl: externalCover.imageUrl,
  });
  expect(await prisma.file.count({ where: { programId: program.id } })).toBe(0);
  expect(
    (await authoring().create(COVER_ACTOR, 'external-create', input)).id,
  ).toBe(program.id);
  await expect(
    authoring().create(COVER_ACTOR, 'external-create', {
      ...input,
      externalCover: {
        ...externalCover,
        imageUrl: externalCover.imageUrl.replace('synthetic', 'changed'),
      },
    }),
  ).rejects.toThrow('idempotency key');
  expect(
    await prisma.file.count({
      where: { kind: 'UPLOAD', uploaderId: { startsWith: PREFIX } },
    }),
  ).toBe(0);
  const programs = new ProgramsService(
    new ProgramsRepository(
      prisma,
      new PlatformRepository(),
      new ProgramListStatusFilterRepository(),
    ),
    new MilestoneCompletionService(),
    new ProgramCoverUrlService(),
    new ProgramScheduleService(),
    new ProgramTemplatesService(),
    Object.create(ProgramViewerService.prototype) as ProgramViewerService,
  );
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
    publicCovers.findPublicCover(program.id, program.id),
  ).resolves.toBeNull();
});

it.each(['owned', 'external', 'none'] as const)(
  'replaces %s with an external cover, tombstoning only an owned object',
  async (previous) => {
    const upload = previous === 'owned' ? await seedUpload() : null;
    const program = await authoring().create(COVER_ACTOR, 'replace-external', {
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
      await prisma.program.findUnique({ where: { id: program.id } }),
    ).toMatchObject({
      coverFileId: null,
      coverSourceUrl: next.sourceUrl,
      coverImageUrl: next.imageUrl,
    });
    const tombstones = await prisma.file.findMany({
      where: { lifecycle: 'DELETE_PENDING', storageKey: { contains: PREFIX } },
    });
    expect(tombstones.map(({ storageKey }) => storageKey)).toEqual(
      upload ? [upload.storageKey] : [],
    );
  },
);

it('retains an external cover when edit omits both choices', async () => {
  const program = await authoring().create(COVER_ACTOR, 'retain-external', {
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
    const program = await authoring().create(COVER_ACTOR, 'remove-external', {
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
    const cover = await prisma.file.findFirst({
      where: { kind: 'COVER', programId: program.id },
    });
    if (upload)
      expect(cover).toMatchObject({
        kind: 'COVER',
        storageKey: upload.storageKey,
      });
    else expect(cover).toBeNull();
    expect(
      await prisma.program.findUnique({ where: { id: program.id } }),
    ).toMatchObject({
      coverFileId: upload?.id ?? null,
      coverSourceUrl: null,
      coverImageUrl: null,
    });
    expect(
      await prisma.file.count({
        where: {
          lifecycle: 'DELETE_PENDING',
          storageKey: { contains: PREFIX },
        },
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
      authoring().create(COVER_ACTOR, 'invalid-external', {
        ...request(),
        externalCover: invalid,
      }),
    ).rejects.toThrow();
    expect(
      await prisma.program.count({ where: { name: { startsWith: PREFIX } } }),
    ).toBe(0);
    const program = await authoring().create(
      COVER_ACTOR,
      'before-invalid-edit',
      {
        ...request(),
        externalCover,
      },
    );
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

it('rejects legacy cover writes and requires a storage key for an owned File', async () => {
  const program = await authoring().create(
    COVER_ACTOR,
    'constraint-external',
    request(),
  );
  await expect(prisma.$executeRaw`
    INSERT INTO "ProgramCover" (id,"programId",source,"sourceUrl","imageUrl","storageKey")
    VALUES ('invalid-legacy-cover',${program.id},'EXTERNAL',${externalCover.sourceUrl},${externalCover.imageUrl},'program-covers/invalid')
  `).rejects.toThrow();
  await expect(prisma.$executeRaw`
    INSERT INTO "File" (id,kind,lifecycle,"programId") VALUES ('invalid-owned','COVER','ATTACHED',${program.id})
  `).rejects.toThrow();
  const cover = await prisma.file.create({
    data: {
      kind: 'COVER',
      lifecycle: 'ATTACHED',
      programId: program.id,
      storageKey: 'program-covers/legacy',
      mimeType: 'image/png',
      sizeBytes: 68,
    },
  });
  expect(cover.kind).toBe('COVER');
});
