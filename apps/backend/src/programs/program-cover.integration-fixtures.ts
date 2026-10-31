import { ProgramAuthoringUploadTransactionRepository } from './program-authoring-upload-transaction.repository';
import { ProgramNoticeFetchClient } from './program-notice-fetch.client';
import { ProgramDeletionScopeRepository } from './program-deletion-scope.repository';
import { LockProgramTreeRepository } from '../platform/lock-program-tree.repository';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ProgramTrackType } from '@prisma/client';
import { AuditLogService } from '../platform/audit-log.service';
import { AuditLogMetadataService } from '../platform/audit-log-metadata.service';
import { PrismaService } from '../platform/prisma.service';
import { ProgramAuthoringRepository } from './program-authoring.repository';
import { ProgramAuthoringService } from './program-authoring.service';
import { ProgramEditorRepository } from './program-editor.repository';
import { ProgramEditorService } from './program-editor.service';
import { ProgramCoverRepository } from './program-cover.repository';
import { ProgramCoverUrlService } from './program-cover-url.service';
import { ProgramRulesService } from './program-rules.service';
import { ProgramUploadRulesService } from './program-upload-rules.service';
import { SubmissionFileRulesService } from './submission-file-rules.service';

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
  new ProgramRulesService(),
  new ProgramUploadRulesService(
    new SubmissionFileRulesService(),
    new ProgramNoticeFetchClient(),
  ),
  new SubmissionFileRulesService(),
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
  return prisma.programAuthoringUpload.create({
    data: {
      actorId,
      storageKey: `${storagePrefix}${PREFIX}${randomUUID()}`,
      originalFileName: 'cover.png',
      mimeType: 'image/png',
      sizeBytes: 68,
      sha256: 'a'.repeat(64),
      expiresAt,
    },
  });
}

async function cleanup() {
  await prisma.programCover.deleteMany({
    where: { program: { name: { startsWith: PREFIX } } },
  });
  await prisma.programPurgeFileTombstone.deleteMany({
    where: { storageKey: { contains: PREFIX } },
  });
  await prisma.programAuthoringUpload.deleteMany({
    where: { actorId: { startsWith: PREFIX } },
  });
  await prisma.programCreateRequest.deleteMany({
    where: { actorId: { startsWith: PREFIX } },
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
      ProgramAuthoringService,
      ProgramAuthoringRepository,
      AuditLogMetadataService,
      ProgramRulesService,
      ProgramUploadRulesService,
      SubmissionFileRulesService,
      { provide: PrismaService, useValue: prisma },
      { provide: AuditLogService, useValue: { record } },
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
      hasStaffAccess: true,
      accountStatus: 'ACTIVE',
    },
  });
});
afterEach(cleanup);
afterAll(() => prisma.$disconnect());
