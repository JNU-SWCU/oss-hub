import {
  FileMetadataRepository,
  ProgramAuthoringUploadTransactionRepository,
  ProgramCoverRepository,
} from './files.repository';
import { UserProfileService } from '../users/user-profile.service';
import { ProgramTemplatesService } from './team-application.service';
import { ProgramScheduleService } from './program-schedule.service';
import {
  SubmissionFileAdmissionService,
  ProgramAuthoringUploadService,
} from './files.service';
import { STATELESS_PROVIDERS } from '../../test/stateless-providers.fixture';
import { ProgramNoticeFetchClient } from './program-notice-fetch.client';
import {
  ProgramDeletionScopeRepository,
  ProgramAuthoringRepository,
} from './programs.repository';
import { LockProgramTreeRepository } from '../platform/lock-program-tree.repository';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ProgramTrackType } from '@prisma/client';
import { ProgramHistoryRepository } from './programs.repository';
import { HistoryMetadataService } from '../platform/history-metadata.service';
import { PrismaService } from '../platform/prisma.service';
import { ProgramAuthoringService } from './programs.service';
import { ProgramEditorRepository } from './program-editor.repository';
import { ProgramEditorService } from './program-editor.service';
import { ProgramCoverUrlService } from './program-cover-url.service';

export const PREFIX = 'test:program-cover:';
export const ACTOR = `${PREFIX}staff`;
export const GITHUB_ID = 9_126_600_001n;
export const COVER_ACTOR = { id: ACTOR, githubId: GITHUB_ID };
export const prisma = new PrismaService();
export const editor = new ProgramEditorService(
  new ProgramEditorRepository(
    prisma,
    new LockProgramTreeRepository(),
    new ProgramDeletionScopeRepository(),
    new ProgramAuthoringUploadTransactionRepository(),
    new ProgramCoverRepository(
      prisma,
      new ProgramAuthoringUploadTransactionRepository(),
    ),
  ),
  new ProgramCoverUrlService(),
  new ProgramScheduleService(),
  new ProgramAuthoringUploadService(
    {} as never,
    {} as never,
    new SubmissionFileAdmissionService(),
    new ProgramNoticeFetchClient(),
  ),
  new UserProfileService(),
);
export const publicCovers = new ProgramCoverRepository(
  prisma,
  new ProgramAuthoringUploadTransactionRepository(),
);
export const record = jest.fn(() => Promise.resolve());
let authoringService: ProgramAuthoringService;
export function authoring(): ProgramAuthoringService {
  return authoringService;
}

export function request() {
  return {
    name: `${PREFIX}program`,
    organizer: 'Synthetic Center',
    trackType: ProgramTrackType.CURRICULAR,
    applicationStartAt: '2026-08-01T00:00:00.000Z',
    applicationEndAt: '2026-08-05T00:00:00.000Z',
    startAt: '2026-08-06T00:00:00.000Z',
    endAt: '2026-09-30T00:00:00.000Z',
    teamMinSize: 1,
    teamMaxSize: 4,
    description: 'Synthetic program cover',
    repositoryProvisioningEnabled: false,
    notifyOnDeadline: false,
    milestones: [
      { name: 'Milestone', dueAt: '2026-09-01T00:00:00.000Z', documents: [] },
    ],
  };
}

export async function seedUpload(
  storagePrefix = 'program-covers/',
  actorId = ACTOR,
  expiresAt = new Date('2099-01-01'),
) {
  const file = await prisma.file.create({
    data: {
      kind: 'UPLOAD',
      lifecycle: 'PENDING',
      uploaderId: actorId,
      storageKey: `${storagePrefix}${PREFIX}${randomUUID()}`,
      originalFileName: 'cover.png',
      mimeType: 'image/png',
      sizeBytes: 68,
      sha256: 'a'.repeat(64),
      pendingExpiresAt: expiresAt,
    },
  });
  return { ...new FileMetadataRepository().read(file), actorId, expiresAt };
}

async function cleanup() {
  await prisma.program.updateMany({
    where: { name: { startsWith: PREFIX } },
    data: { coverFileId: null },
  });
  await prisma.file.deleteMany({
    where: {
      OR: [
        { program: { name: { startsWith: PREFIX } } },
        { uploaderId: { startsWith: PREFIX } },
      ],
    },
  });
  await prisma.team.deleteMany({
    where: { program: { name: { startsWith: PREFIX } } },
  });
  await prisma.requirement.deleteMany({
    where: { milestone: { program: { name: { startsWith: PREFIX } } } },
  });
  await prisma.milestone.deleteMany({
    where: { program: { name: { startsWith: PREFIX } } },
  });
  await prisma.program.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  await prisma.$connect();
  const moduleRef = await Test.createTestingModule({
    providers: [
      ...STATELESS_PROVIDERS,
      ProgramCoverRepository,
      ProgramAuthoringService,
      ProgramAuthoringRepository,
      HistoryMetadataService,
      ProgramScheduleService,
      ProgramTemplatesService,
      {
        provide: ProgramAuthoringUploadService,
        useValue: new ProgramAuthoringUploadService(
          {} as never,
          {} as never,
          new SubmissionFileAdmissionService(),
          new ProgramNoticeFetchClient(),
        ),
      },
      { provide: PrismaService, useValue: prisma },
      { provide: ProgramHistoryRepository, useValue: { append: record } },
    ],
  }).compile();
  authoringService = moduleRef.get(ProgramAuthoringService);
});
beforeEach(async () => {
  await cleanup();
  record.mockReset();
  record.mockResolvedValue();
  await prisma.user.create({
    data: {
      id: ACTOR,
      githubId: GITHUB_ID,
      nickname: 'synthetic-cover-staff',
      accountStatus: 'ACTIVE',
      type: 'STAFF',
      approvalStatus: 'APPROVED',
      name: 'Synthetic staff',
      department: 'Synthetic department',
      profileCreatedAt: new Date('2026-01-01T00:00:00.000Z'),
      profileUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
      departmentType: 'DEPARTMENT',
    },
  });
});
afterEach(cleanup);
afterAll(() => prisma.$disconnect());
