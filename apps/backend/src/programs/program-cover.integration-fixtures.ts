import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ProgramTrackType } from '@prisma/client';
import { AuditLogService } from '../audit-log/audit-log.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProgramAuthoringRepository } from './program-authoring.repository';
import { ProgramAuthoringService } from './program-authoring.service';
import { ProgramEditorRepository } from './repository/program-editor.repository';
import { ProgramEditorService } from './service/program-editor.service';
import { ProgramCoverRepository } from './repository/program-cover.repository';

export const PREFIX = 'test:program-cover:';
export const ACTOR = `${PREFIX}staff`;
export const GITHUB_ID = 9_126_600_001n;
export const prisma = new PrismaService();
export const editor = new ProgramEditorService(
  new ProgramEditorRepository(prisma),
);
export const publicCovers = new ProgramCoverRepository(prisma);
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
