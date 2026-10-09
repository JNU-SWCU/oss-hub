import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';
import {
  AccountStatus,
  ApplicationStatus,
  MemberKind,
  MilestoneDocumentKind,
  MilestoneDocumentSubmissionHistoryEvent,
  SubmissionFileLifecycle,
} from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../prisma/prisma.service';
import type { ObjectStoragePort } from '../storage/domain/object-storage';
import { SubmissionFilesRepository } from '../submissions/submission-files.repository';
import { MilestoneDocumentCurrentFileRepository } from './milestone-document-current-file.repository';
import { MilestoneDocumentCurrentFileService } from './milestone-document-current-file.service';
import { MilestoneDocumentFilesService } from './milestone-document-files.service';
import { MilestoneDocumentsErrorCode } from './milestone-documents-error-code.enum';
import { MilestoneDocumentsRepository } from './repository/milestone-documents.repository';
import { MilestoneDocumentsService } from './milestone-documents.service';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prefix = 'milestone-current-file-auth';

const programId = `${prefix}-program`;
const milestoneId = `${prefix}-milestone`;
const otherMilestoneId = `${prefix}-other-milestone`;
const ownDocumentId = `${prefix}-document-own`;
const neighbourDocumentId = `${prefix}-document-neighbour`;
const legacyDocumentId = `${prefix}-document-legacy`;

const expiredDocumentId = `${prefix}-document-expired`;
const deletePendingDocumentId = `${prefix}-document-delete-pending`;
const staleRevisionDocumentId = `${prefix}-document-stale-revision`;

const unknownDocumentId = `${prefix}-document-unknown`;

const outsideProgramId = `${prefix}-outside-program`;
const outsideMilestoneId = `${prefix}-outside-milestone`;
const outsideDocumentId = `${prefix}-outside-document`;

const users = {
  revertedLeader: {
    id: `${prefix}-reverted-leader`,
    githubId: 9_600_000_000_997_001n,
  },
  revertedMember: {
    id: `${prefix}-reverted-member`,
    githubId: 9_600_000_000_997_002n,
  },
  approvedLeader: {
    id: `${prefix}-approved-leader`,
    githubId: 9_600_000_000_997_003n,
  },
  neighbourLeader: {
    id: `${prefix}-neighbour-leader`,
    githubId: 9_600_000_000_997_004n,
  },

  departedApplicant: {
    id: `${prefix}-departed-applicant`,
    githubId: 9_600_000_000_997_005n,
  },

  successorLeader: {
    id: `${prefix}-successor-leader`,
    githubId: 9_600_000_000_997_006n,
  },

  outsider: { id: `${prefix}-outsider`, githubId: 9_600_000_000_997_007n },

  deactivatedMember: {
    id: `${prefix}-deactivated-member`,
    githubId: 9_600_000_000_997_008n,
    accountStatus: AccountStatus.DEACTIVATED,
  },

  staff: {
    id: `${prefix}-staff`,
    githubId: 9_600_000_000_997_009n,
    hasStaffAccess: true,
  },

  staffTeammate: {
    id: `${prefix}-staff-teammate`,
    githubId: 9_600_000_000_997_010n,
    hasStaffAccess: true,
  },

  rejectedLeader: {
    id: `${prefix}-rejected-leader`,
    githubId: 9_600_000_000_997_011n,
  },

  bareLeader: {
    id: `${prefix}-bare-leader`,
    githubId: 9_600_000_000_997_012n,
  },

  formerUploader: {
    id: `${prefix}-former-uploader`,
    githubId: 9_600_000_000_997_013n,
  },

  retainedLeader: {
    id: `${prefix}-retained-leader`,
    githubId: 9_600_000_000_997_014n,
  },
} as const;

const prisma = new PrismaService();
const documentsRepository = new MilestoneDocumentsRepository(prisma);
const documentsService = new MilestoneDocumentsService(documentsRepository);

const storage: ObjectStoragePort = {
  put: () => Promise.reject(new Error('unused')),
  get: (objectKey: string) =>
    Promise.resolve(Readable.from(Buffer.from(`bytes:${objectKey}`))),
  delete: () => Promise.reject(new Error('unused')),
};

const currentFileService = new MilestoneDocumentCurrentFileService(
  new MilestoneDocumentCurrentFileRepository(
    prisma as unknown as ConstructorParameters<
      typeof MilestoneDocumentCurrentFileRepository
    >[0],
  ),
  storage,
);

const staffFilesService = new MilestoneDocumentFilesService(
  documentsRepository,
  storage,
  new SubmissionFilesRepository(prisma),
);

interface TeamFixture {
  readonly key: string;
  readonly leaderId: string;

  readonly memberIds: readonly string[];

  readonly applicantId?: string;
  readonly status: ApplicationStatus;
}

async function cleanup(): Promise<void> {
  await prisma.submissionFile.deleteMany({
    where: { storageKey: { startsWith: `${prefix}/` } },
  });
  await prisma.milestoneDocumentSubmissionHistory.deleteMany({
    where: { submission: { is: { applicationId: { startsWith: prefix } } } },
  });
  await prisma.milestoneDocumentSubmission.deleteMany({
    where: { applicationId: { startsWith: prefix } },
  });
  await prisma.application.deleteMany({
    where: { programId: { in: [programId, outsideProgramId] } },
  });
  await prisma.teamMember.deleteMany({
    where: { programId: { in: [programId, outsideProgramId] } },
  });
  await prisma.team.deleteMany({
    where: { programId: { in: [programId, outsideProgramId] } },
  });
  await prisma.milestoneDocument.deleteMany({
    where: {
      milestoneId: { in: [milestoneId, otherMilestoneId, outsideMilestoneId] },
    },
  });
  await prisma.milestone.deleteMany({
    where: { id: { in: [milestoneId, otherMilestoneId, outsideMilestoneId] } },
  });
  await prisma.program.deleteMany({
    where: { id: { in: [programId, outsideProgramId] } },
  });
  await prisma.user.deleteMany({ where: { id: { startsWith: prefix } } });
}

async function createProgram(
  id: string,
  milestoneIds: readonly string[],
): Promise<void> {
  await prisma.program.create({
    data: {
      id,
      name: `synthetic ${id}`,
      organizer: 'OSS Hub',
      category: 'CAPSTONE',
      applicationTemplateKey: 'capstone-v1',
      applicationTemplateVersion: 1,
      applicationStartAt: new Date('2025-12-01'),
      applicationEndAt: new Date('2026-01-01'),
      startAt: new Date('2026-01-02'),
      endAt: new Date('2026-12-31'),
      description: 'synthetic integration fixture',
      milestones: {
        create: milestoneIds.map((each) => ({
          id: each,
          name: `synthetic ${each}`,
          dueAt: new Date('2026-11-01'),
          submissionType: 'FILE',
        })),
      },
    },
  });
}

async function createTeamWithApplication(
  programIdOfTeam: string,
  team: TeamFixture,
): Promise<string> {
  const teamId = `${prefix}-${team.key}-team`;
  await prisma.team.create({
    data: {
      id: teamId,
      programId: programIdOfTeam,
      name: `synthetic ${team.key} 팀`,
      joinCodeDigest: `digest:${prefix}:${team.key}`,
      leaderId: team.leaderId,
    },
  });
  for (const userId of team.memberIds) {
    await prisma.teamMember.create({
      data: {
        id: `${prefix}-${team.key}-${userId}`,
        teamId,
        programId: programIdOfTeam,
        userId,
      },
    });
  }
  const applicationId = `${prefix}-${team.key}-application`;
  await prisma.application.create({
    data: {
      id: applicationId,
      programId: programIdOfTeam,
      applicantId: team.applicantId ?? team.leaderId,
      teamId,
      answers: { syntheticFixture: true },
      applicationTemplateVersion: 1,
      status: team.status,
      processedAt: new Date('2026-02-01'),
    },
  });
  return applicationId;
}

async function seedSubmissionWithFile(input: {
  readonly key: string;
  readonly documentId: string;
  readonly applicationId: string;
  readonly actorId: string;
  readonly milestoneIdOfFile: string;

  readonly revision?: number;
  readonly historyRevision?: number;
  readonly lifecycle?: SubmissionFileLifecycle;
  readonly expiresAt?: Date;
}): Promise<string> {
  const submissionId = `${prefix}-${input.key}-submission`;
  const revision = input.revision ?? 1;
  await prisma.milestoneDocumentSubmission.create({
    data: {
      id: submissionId,
      milestoneDocumentId: input.documentId,
      applicationId: input.applicationId,
      submittedById: input.actorId,
      submittedAt: new Date('2026-03-01'),
      revision,
    },
  });
  const historyId = `${prefix}-${input.key}-history`;
  await prisma.milestoneDocumentSubmissionHistory.create({
    data: {
      id: historyId,
      milestoneDocumentSubmissionId: submissionId,
      event: MilestoneDocumentSubmissionHistoryEvent.SUBMITTED,
      revision: input.historyRevision ?? revision,
      actorId: input.actorId,
      createdAt: new Date('2026-03-01'),
    },
  });
  const storageKey = `${prefix}/${input.key}.pdf`;
  await prisma.submissionFile.create({
    data: {
      id: `${prefix}-${input.key}-file`,
      uploaderId: input.actorId,
      applicationId: input.applicationId,
      milestoneId: input.milestoneIdOfFile,
      storageKey,
      originalFileName: `${input.key}.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: `bytes:${storageKey}`.length,
      milestoneDocumentSubmissionId: submissionId,
      milestoneDocumentSubmissionHistoryId: historyId,

      lifecycle: input.lifecycle ?? SubmissionFileLifecycle.ATTACHED,
      expiresAt: input.expiresAt ?? new Date('2099-01-01'),
    },
  });
  return storageKey;
}

async function downloadFails(
  githubId: bigint,
  requestedMilestoneId: string,
  documentId: string,
): Promise<{ readonly code: string; readonly status: number }> {
  try {
    await currentFileService.download(
      githubId,
      requestedMilestoneId,
      documentId,
    );
  } catch (error: unknown) {
    const { errorCode } = error as {
      errorCode: { code: string; status: number };
    };
    return { code: errorCode.code, status: errorCode.status };
  }
  throw new Error('내려받기가 거절되지 않았습니다.');
}

const hiddenAsMissing = {
  code: MilestoneDocumentsErrorCode.SUBMISSION_FILE_NOT_FOUND,
  status: 404,
};

let ownStorageKey = '';
let neighbourStorageKey = '';
let outsideStorageKey = '';
let revertedApplicationId = '';

describe('마일스톤 서류 현재 제출 파일 — 「보기」와 「받기」의 자격', () => {
  beforeAll(async () => {
    await prisma.$connect();
    await cleanup();

    await prisma.user.createMany({
      data: Object.entries(users).map(([key, user]) => ({
        id: user.id,
        githubId: user.githubId,
        nickname: `${prefix}-${key}`,
        selectedMemberKind: MemberKind.STUDENT,
        accountStatus:
          'accountStatus' in user ? user.accountStatus : AccountStatus.ACTIVE,
        hasStaffAccess: 'hasStaffAccess' in user ? user.hasStaffAccess : false,
      })),
    });

    await createProgram(programId, [milestoneId, otherMilestoneId]);
    await createProgram(outsideProgramId, [outsideMilestoneId]);

    await prisma.milestoneDocument.createMany({
      data: [
        {
          id: ownDocumentId,
          milestoneId,
          name: '내 팀이 낸 서류',
          required: true,
          sortOrder: 1,
        },
        {
          id: neighbourDocumentId,
          milestoneId,
          name: '옆 팀만 낸 서류',
          required: false,
          sortOrder: 2,
        },
        {
          id: legacyDocumentId,
          milestoneId,
          name: '옛 마일스톤 제출 슬롯',
          required: false,
          sortOrder: 3,
          kind: MilestoneDocumentKind.LEGACY_MILESTONE_SUBMISSION,
        },
        {
          id: expiredDocumentId,
          milestoneId,
          name: '첨부가 만료된 서류',
          required: false,
          sortOrder: 4,
        },
        {
          id: deletePendingDocumentId,
          milestoneId,
          name: '첨부가 삭제 대기로 넘어간 서류',
          required: false,
          sortOrder: 5,
        },
        {
          id: staleRevisionDocumentId,
          milestoneId,
          name: '첨부가 옛 제출본에 남은 서류',
          required: false,
          sortOrder: 6,
        },
        {
          id: outsideDocumentId,
          milestoneId: outsideMilestoneId,
          name: '무관한 프로그램의 서류',
          required: true,
          sortOrder: 1,
        },
      ],
    });

    revertedApplicationId = await createTeamWithApplication(programId, {
      key: 'reverted',
      leaderId: users.revertedLeader.id,
      memberIds: [
        users.revertedLeader.id,
        users.revertedMember.id,
        users.deactivatedMember.id,
        users.staffTeammate.id,
      ],
      status: ApplicationStatus.SUBMITTED,
    });
    ownStorageKey = await seedSubmissionWithFile({
      key: 'reverted-own',
      documentId: ownDocumentId,
      applicationId: revertedApplicationId,
      actorId: users.revertedLeader.id,
      milestoneIdOfFile: milestoneId,
    });
    await seedSubmissionWithFile({
      key: 'reverted-legacy',
      documentId: legacyDocumentId,
      applicationId: revertedApplicationId,
      actorId: users.revertedLeader.id,
      milestoneIdOfFile: milestoneId,
    });

    await seedSubmissionWithFile({
      key: 'reverted-expired',
      documentId: expiredDocumentId,
      applicationId: revertedApplicationId,
      actorId: users.revertedLeader.id,
      milestoneIdOfFile: milestoneId,
      expiresAt: new Date('2026-01-01'),
    });
    await seedSubmissionWithFile({
      key: 'reverted-delete-pending',
      documentId: deletePendingDocumentId,
      applicationId: revertedApplicationId,
      actorId: users.revertedLeader.id,
      milestoneIdOfFile: milestoneId,
      lifecycle: SubmissionFileLifecycle.DELETE_PENDING,
    });
    await seedSubmissionWithFile({
      key: 'reverted-stale-revision',
      documentId: staleRevisionDocumentId,
      applicationId: revertedApplicationId,
      actorId: users.revertedLeader.id,
      milestoneIdOfFile: milestoneId,
      revision: 2,
      historyRevision: 1,
    });

    const rejectedApplicationId = await createTeamWithApplication(programId, {
      key: 'rejected',
      leaderId: users.rejectedLeader.id,
      memberIds: [users.rejectedLeader.id],
      status: ApplicationStatus.REJECTED,
    });
    await seedSubmissionWithFile({
      key: 'rejected-own',
      documentId: ownDocumentId,
      applicationId: rejectedApplicationId,
      actorId: users.rejectedLeader.id,
      milestoneIdOfFile: milestoneId,
    });

    const approvedApplicationId = await createTeamWithApplication(programId, {
      key: 'approved',
      leaderId: users.approvedLeader.id,
      memberIds: [users.approvedLeader.id],
      status: ApplicationStatus.APPROVED,
    });
    await seedSubmissionWithFile({
      key: 'approved-own',
      documentId: ownDocumentId,
      applicationId: approvedApplicationId,
      actorId: users.approvedLeader.id,
      milestoneIdOfFile: milestoneId,
    });

    const neighbourApplicationId = await createTeamWithApplication(programId, {
      key: 'neighbour',
      leaderId: users.neighbourLeader.id,
      memberIds: [users.neighbourLeader.id],
      status: ApplicationStatus.APPROVED,
    });
    neighbourStorageKey = await seedSubmissionWithFile({
      key: 'neighbour-only',
      documentId: neighbourDocumentId,
      applicationId: neighbourApplicationId,
      actorId: users.neighbourLeader.id,
      milestoneIdOfFile: milestoneId,
    });

    const departedApplicationId = await createTeamWithApplication(programId, {
      key: 'departed',
      leaderId: users.successorLeader.id,
      memberIds: [users.successorLeader.id],
      applicantId: users.departedApplicant.id,
      status: ApplicationStatus.APPROVED,
    });
    await seedSubmissionWithFile({
      key: 'departed-team',
      documentId: neighbourDocumentId,
      applicationId: departedApplicationId,
      actorId: users.successorLeader.id,
      milestoneIdOfFile: milestoneId,
    });

    const outsideApplicationId = await createTeamWithApplication(
      outsideProgramId,
      {
        key: 'outsider',
        leaderId: users.outsider.id,
        memberIds: [users.outsider.id],
        status: ApplicationStatus.APPROVED,
      },
    );
    outsideStorageKey = await seedSubmissionWithFile({
      key: 'outsider-own',
      documentId: outsideDocumentId,
      applicationId: outsideApplicationId,
      actorId: users.outsider.id,
      milestoneIdOfFile: outsideMilestoneId,
    });

    const bareLeaderApplicationId = await createTeamWithApplication(programId, {
      key: 'bare-leader',
      leaderId: users.bareLeader.id,
      memberIds: [],
      status: ApplicationStatus.APPROVED,
    });
    await seedSubmissionWithFile({
      key: 'bare-leader-own',
      documentId: ownDocumentId,
      applicationId: bareLeaderApplicationId,
      actorId: users.bareLeader.id,
      milestoneIdOfFile: milestoneId,
    });

    const formerApplicationId = await createTeamWithApplication(programId, {
      key: 'former',
      leaderId: users.retainedLeader.id,
      memberIds: [users.retainedLeader.id, users.formerUploader.id],
      applicantId: users.formerUploader.id,
      status: ApplicationStatus.APPROVED,
    });
    await seedSubmissionWithFile({
      key: 'former-own',
      documentId: ownDocumentId,
      applicationId: formerApplicationId,
      actorId: users.formerUploader.id,
      milestoneIdOfFile: milestoneId,
    });
    await prisma.teamMember.delete({
      where: { id: `${prefix}-former-${users.formerUploader.id}` },
    });
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it('되돌려진 학생이 목록에서 본 파일을 그대로 받는다', async () => {
    const documents = await documentsService.listForViewer(
      users.revertedLeader.githubId,
      milestoneId,
    );
    const own = documents.find((document) => document.id === ownDocumentId);
    expect(own?.viewerSubmission?.hasCurrentFile).toBe(true);

    const file = await currentFileService.download(
      users.revertedLeader.githubId,
      milestoneId,
      ownDocumentId,
    );

    expect(file.fileName).toBe('reverted-own.pdf');
    expect(file.contentType).toBe('application/pdf');
    await expect(buffer(file.body)).resolves.toEqual(
      Buffer.from(`bytes:${ownStorageKey}`),
    );
  });

  it('되돌려진 신청의 팀원도 같은 파일을 받는다', async () => {
    const file = await currentFileService.download(
      users.revertedMember.githubId,
      milestoneId,
      ownDocumentId,
    );

    expect(file.fileName).toBe('reverted-own.pdf');
    await expect(buffer(file.body)).resolves.toEqual(
      Buffer.from(`bytes:${ownStorageKey}`),
    );
  });

  it('거절된 신청의 학생에게도 목록과 받기가 같은 답을 한다', async () => {
    const documents = await documentsService.listForViewer(
      users.rejectedLeader.githubId,
      milestoneId,
    );
    const own = documents.find((document) => document.id === ownDocumentId);
    expect(own?.viewerSubmission?.hasCurrentFile).toBe(true);

    const file = await currentFileService.download(
      users.rejectedLeader.githubId,
      milestoneId,
      ownDocumentId,
    );
    expect(file.fileName).toBe('rejected-own.pdf');
  });

  it.each([
    ['만료된 첨부', expiredDocumentId],
    ['삭제 대기로 넘어간 첨부', deletePendingDocumentId],
    ['옛 제출본에 남은 첨부', staleRevisionDocumentId],
  ])('%s: 목록에도 없고 받기에서도 404다', async (_label, documentId) => {
    const documents = await documentsService.listForViewer(
      users.revertedLeader.githubId,
      milestoneId,
    );
    const target = documents.find((document) => document.id === documentId);
    expect(target?.viewerSubmission?.submitted).toBe(true);
    expect(target?.viewerSubmission?.hasCurrentFile).toBe(false);

    await expect(
      downloadFails(users.revertedLeader.githubId, milestoneId, documentId),
    ).resolves.toEqual(hiddenAsMissing);
  });

  it('승인이 유지된 학생의 내려받기는 그대로다', async () => {
    const file = await currentFileService.download(
      users.approvedLeader.githubId,
      milestoneId,
      ownDocumentId,
    );

    expect(file.fileName).toBe('approved-own.pdf');
  });

  it.each([
    ['되돌려진 팀장', users.revertedLeader.githubId],
    ['되돌려진 팀원', users.revertedMember.githubId],
    ['승인이 유지된 팀장', users.approvedLeader.githubId],
    ['거절된 신청의 팀장', users.rejectedLeader.githubId],
    ['옆 팀 팀장', users.neighbourLeader.githubId],
  ])(
    '%s의 목록에서 hasCurrentFile인 서류는 전부 받아지고, 아닌 서류는 전부 404다',
    async (_label, githubId) => {
      const documents = await documentsService.listForViewer(
        githubId,
        milestoneId,
      );
      expect(documents.length).toBeGreaterThan(0);

      for (const document of documents) {
        if (document.viewerSubmission?.hasCurrentFile === true) {
          await expect(
            currentFileService.download(githubId, milestoneId, document.id),
          ).resolves.toMatchObject({ contentType: 'application/pdf' });
        } else {
          await expect(
            downloadFails(githubId, milestoneId, document.id),
          ).resolves.toEqual(hiddenAsMissing);
        }
      }
    },
  );

  it('남의 팀만 낸 서류는 파일이 있어도 존재하지 않는 파일과 같은 404다', async () => {
    await expect(
      currentFileService.download(
        users.neighbourLeader.githubId,
        milestoneId,
        neighbourDocumentId,
      ),
    ).resolves.toMatchObject({ fileName: 'neighbour-only.pdf' });

    await expect(
      downloadFails(
        users.revertedLeader.githubId,
        milestoneId,
        neighbourDocumentId,
      ),
    ).resolves.toEqual(hiddenAsMissing);
    expect(neighbourStorageKey).toBe(`${prefix}/neighbour-only.pdf`);
  });

  it('무관한 프로그램의 서류는 양쪽 방향 모두 404다', async () => {
    await expect(
      currentFileService.download(
        users.outsider.githubId,
        outsideMilestoneId,
        outsideDocumentId,
      ),
    ).resolves.toMatchObject({ fileName: 'outsider-own.pdf' });
    expect(outsideStorageKey).toBe(`${prefix}/outsider-own.pdf`);

    await expect(
      downloadFails(
        users.revertedLeader.githubId,
        outsideMilestoneId,
        outsideDocumentId,
      ),
    ).resolves.toEqual(hiddenAsMissing);
    await expect(
      downloadFails(users.outsider.githubId, milestoneId, ownDocumentId),
    ).resolves.toEqual(hiddenAsMissing);
  });

  it('같은 프로그램의 다른 마일스톤 id로는 같은 서류도 열리지 않는다', async () => {
    await expect(
      downloadFails(
        users.revertedLeader.githubId,
        otherMilestoneId,
        ownDocumentId,
      ),
    ).resolves.toEqual(hiddenAsMissing);
  });

  it('팀을 떠난 신청자에게는 목록도 받기도 닫혀 있다', async () => {
    const documents = await documentsService.listForViewer(
      users.departedApplicant.githubId,
      milestoneId,
    );
    expect(
      documents.every((document) => document.viewerSubmission === undefined),
    ).toBe(true);

    await expect(
      downloadFails(
        users.departedApplicant.githubId,
        milestoneId,
        neighbourDocumentId,
      ),
    ).resolves.toEqual(hiddenAsMissing);
  });

  it('팀장 자리만 있고 팀원 행이 없는 사람에게는 목록도 받기도 닫혀 있다', async () => {
    const documents = await documentsService.listForViewer(
      users.bareLeader.githubId,
      milestoneId,
    );
    expect(
      documents.every((document) => document.viewerSubmission === undefined),
    ).toBe(true);

    await expect(
      downloadFails(users.bareLeader.githubId, milestoneId, ownDocumentId),
    ).resolves.toEqual(hiddenAsMissing);
  });

  it('파일을 올리고 신청까지 낸 사람도 팀원 행이 지워지면 모르는 서류와 같은 404를 받는다', async () => {
    const application = await prisma.application.findUniqueOrThrow({
      where: { id: `${prefix}-former-application` },
      select: { applicantId: true },
    });
    expect(application.applicantId).toBe(users.formerUploader.id);
    const file = await prisma.submissionFile.findUniqueOrThrow({
      where: { id: `${prefix}-former-own-file` },
      select: { uploaderId: true, lifecycle: true },
    });
    expect(file.uploaderId).toBe(users.formerUploader.id);
    expect(file.lifecycle).toBe(SubmissionFileLifecycle.ATTACHED);

    const denied = await downloadFails(
      users.formerUploader.githubId,
      milestoneId,
      ownDocumentId,
    );

    expect(denied).toEqual(
      await downloadFails(
        users.formerUploader.githubId,
        milestoneId,
        unknownDocumentId,
      ),
    );
    expect(denied).toEqual(hiddenAsMissing);
  });

  it('멤버십을 가진 현재 팀장은 제외된 사람이 올렸던 파일을 그대로 받는다', async () => {
    const documents = await documentsService.listForViewer(
      users.retainedLeader.githubId,
      milestoneId,
    );
    const own = documents.find((document) => document.id === ownDocumentId);
    expect(own?.viewerSubmission?.hasCurrentFile).toBe(true);

    const file = await currentFileService.download(
      users.retainedLeader.githubId,
      milestoneId,
      ownDocumentId,
    );
    expect(file.fileName).toBe('former-own.pdf');
    await expect(buffer(file.body)).resolves.toEqual(
      Buffer.from(`bytes:${prefix}/former-own.pdf`),
    );
  });

  it('목록에 뜨지 않는 옛 제출 슬롯은 받기에서도 없다', async () => {
    const documents = await documentsService.listForViewer(
      users.revertedLeader.githubId,
      milestoneId,
    );
    expect(documents.map((document) => document.id)).not.toContain(
      legacyDocumentId,
    );

    await expect(
      downloadFails(
        users.revertedLeader.githubId,
        milestoneId,
        legacyDocumentId,
      ),
    ).resolves.toEqual(hiddenAsMissing);
  });

  it('비활성 계정은 팀원이어도 목록도 받기도 닫혀 있다', async () => {
    const documents = await documentsService.listForViewer(
      users.deactivatedMember.githubId,
      milestoneId,
    );
    expect(
      documents.every((document) => document.viewerSubmission === undefined),
    ).toBe(true);

    await expect(
      downloadFails(
        users.deactivatedMember.githubId,
        milestoneId,
        ownDocumentId,
      ),
    ).resolves.toEqual(hiddenAsMissing);
  });

  it('교직원은 학생 경로로 받지 못한다', async () => {
    const documents = await documentsService.listForViewer(
      users.staff.githubId,
      milestoneId,
    );
    expect(
      documents.every((document) => document.viewerSubmission === undefined),
    ).toBe(true);

    await expect(
      downloadFails(users.staff.githubId, milestoneId, ownDocumentId),
    ).resolves.toEqual(hiddenAsMissing);
  });

  it('교직원은 그 팀의 팀원이어도 학생 경로로 받지 못한다', async () => {
    const documents = await documentsService.listForViewer(
      users.staffTeammate.githubId,
      milestoneId,
    );
    expect(
      documents.every((document) => document.viewerSubmission === undefined),
    ).toBe(true);

    await expect(
      downloadFails(users.staffTeammate.githubId, milestoneId, ownDocumentId),
    ).resolves.toEqual(hiddenAsMissing);
  });

  it('교직원 전용 경로는 되돌려진 신청의 같은 파일을 그대로 돌려준다', async () => {
    const file = await staffFilesService.downloadSubmissionFile(
      milestoneId,
      ownDocumentId,
      revertedApplicationId,
    );

    await expect(buffer(file.body)).resolves.toEqual(
      Buffer.from(`bytes:${ownStorageKey}`),
    );
  });
});
