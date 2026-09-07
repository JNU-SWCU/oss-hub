import { ApplicationStatus, SubmissionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { S3SubmissionFileStorage } from '../submissions/s3-submission-file.storage';
import { SubmissionFileStorageConfig } from '../submissions/submission-file-storage.config';
import { MilestoneDocumentArchiveRepository } from './milestone-document-archive.repository';
import { MilestoneDocumentArchiveService } from './milestone-document-archive.service';
import { MilestoneDocumentsRepository } from './milestone-documents.repository';

const prefix = 'qa152-program-archive';
export const archiveId = (suffix: string) => `${prefix}-${suffix}`;
export const archiveNow = new Date('2026-09-03T00:00:00Z');
export const retainedImage = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

export class ProgramArchiveIntegrationFixture {
  readonly prisma = new PrismaService();
  readonly storage = new S3SubmissionFileStorage(
    new SubmissionFileStorageConfig(),
  );
  readonly service = new MilestoneDocumentArchiveService(
    new MilestoneDocumentsRepository(this.prisma),
    this.storage,
    new MilestoneDocumentArchiveRepository(this.prisma),
  );

  async seed(): Promise<void> {
    await this.prisma.$connect();
    await this.clear();
    await this.prisma.user.create({
      data: {
        id: archiveId('user'),
        githubId: 960000001135099n,
        nickname: archiveId('user'),
      },
    });
    for (const suffix of ['a', 'b']) {
      await this.prisma.program.create({
        data: {
          id: archiveId(suffix),
          name: `합성 프로그램 ${suffix}`,
          organizer: 'OSS Hub',
          category: 'CAPSTONE',
          applicationTemplateKey: 'capstone-v1',
          applicationTemplateVersion: 1,
          applicationStartAt: new Date('2026-01-01'),
          applicationEndAt: new Date('2026-02-01'),
          startAt: new Date('2026-02-02'),
          endAt: new Date('2099-12-31'),
          description: 'synthetic archive fixture',
        },
      });
    }
    for (const [stage, program] of [
      ['a1', 'a'],
      ['a2', 'a'],
      ['b1', 'b'],
    ] as const) {
      await this.prisma.milestone.create({
        data: {
          id: archiveId(stage),
          programId: archiveId(program),
          name: `단계 ${stage}`,
          dueAt: new Date('2026-12-01'),
          documents: {
            create: {
              id: archiveId(`doc-${stage}`),
              name: '보고서',
              required: true,
              sortOrder: 1,
            },
          },
        },
      });
    }
    await this.prisma.milestoneDocument.create({
      data: {
        id: archiveId('legacy'),
        milestoneId: archiveId('a1'),
        name: '숨긴 레거시',
        required: false,
        sortOrder: 2,
        kind: 'LEGACY_MILESTONE_SUBMISSION',
      },
    });
    for (const index of [0, 1, 2, 3]) {
      const programId = archiveId(index === 3 ? 'b' : 'a');
      await this.prisma.team.create({
        data: {
          id: archiveId(`team-${index}`),
          programId,
          name: `합성 팀 ${index}`,
          joinCodeDigest: archiveId(`digest-${index}`),
          leaderId: archiveId('user'),
        },
      });
      await this.prisma.application.create({
        data: {
          id: archiveId(`app-${index}`),
          programId,
          teamId: archiveId(`team-${index}`),
          applicantId: archiveId('user'),
          answers: {},
          applicationTemplateVersion: 1,
          status:
            index === 2
              ? ApplicationStatus.SUBMITTED
              : ApplicationStatus.APPROVED,
        },
      });
    }
    for (const [team, stage, status] of [
      [0, 'a1', SubmissionStatus.REJECTED],
      [0, 'a2', SubmissionStatus.CHANGES_REQUESTED],
      [1, 'a1', SubmissionStatus.APPROVED],
      [2, 'a1', SubmissionStatus.SUBMITTED],
      [3, 'b1', SubmissionStatus.SUBMITTED],
    ] as const) {
      await this.prisma.milestoneDocumentSubmission.create({
        data: {
          id: archiveId(`submission-${team}-${stage}`),
          milestoneDocumentId: archiveId(`doc-${stage}`),
          applicationId: archiveId(`app-${team}`),
          submittedById: archiveId('user'),
          submittedAt: archiveNow,
          revision: 2,
          status,
          content: { type: 'TEXT', text: `current-${team}-${stage}` },
          histories: {
            create: [1, 2].map((revision) => ({
              id: archiveId(`history-${team}-${stage}-${revision}`),
              event: revision === 1 ? 'SUBMITTED' : 'RESUBMITTED',
              revision,
              actorId: archiveId('user'),
              content: {
                type: 'TEXT',
                text:
                  revision === 1
                    ? 'previous-revision-must-not-export'
                    : `current-${team}-${stage}`,
              },
            })),
          },
        },
      });
    }
    await this.addFile('a1', 1, Buffer.from('%PDF-previous'), 'pdf');
    await this.addFile('a1', 2, retainedImage, 'png');
    await this.addFile('a2', 1, Buffer.from('%PDF-omitted-on-revision'), 'pdf');
  }

  private async addFile(
    stage: string,
    revision: number,
    body: Buffer,
    extension: string,
  ): Promise<void> {
    const storageKey = `${prefix}/${stage}-${revision}`;
    const originalName = `synthetic.${extension}`;
    await this.storage.put({
      body,
      contentType: 'application/octet-stream',
      originalName,
      objectKey: storageKey,
    });
    await this.prisma.submissionFile.create({
      data: {
        id: archiveId(`file-${stage}-${revision}`),
        uploaderId: archiveId('user'),
        applicationId: archiveId('app-0'),
        milestoneId: archiveId(stage),
        milestoneDocumentSubmissionId: archiveId(`submission-0-${stage}`),
        milestoneDocumentSubmissionHistoryId: archiveId(
          `history-0-${stage}-${revision}`,
        ),
        lifecycle: 'ATTACHED',
        expiresAt: new Date('2099-12-31'),
        storageKey,
        originalFileName: originalName,
        mimeType: 'application/octet-stream',
        sizeBytes: body.length,
      },
    });
  }

  async clear(): Promise<void> {
    const programs = { in: [archiveId('a'), archiveId('b')] };
    const files = await this.prisma.submissionFile.findMany({
      where: { uploaderId: archiveId('user') },
      select: { storageKey: true },
    });
    await Promise.all(
      files.map((file) => this.storage.delete(file.storageKey)),
    );
    await this.prisma.submissionFile.deleteMany({
      where: { uploaderId: archiveId('user') },
    });
    const submissions = { application: { programId: programs } };
    await this.prisma.milestoneDocumentSubmissionHistory.deleteMany({
      where: { submission: submissions },
    });
    await this.prisma.milestoneDocumentSubmission.deleteMany({
      where: submissions,
    });
    await this.prisma.milestoneDocument.deleteMany({
      where: { milestone: { programId: programs } },
    });
    await this.prisma.milestone.deleteMany({ where: { programId: programs } });
    await this.prisma.application.deleteMany({
      where: { programId: programs },
    });
    await this.prisma.team.deleteMany({ where: { programId: programs } });
    await this.prisma.program.deleteMany({ where: { id: programs } });
    await this.prisma.user.deleteMany({ where: { id: archiveId('user') } });
  }

  async stop(): Promise<void> {
    await this.clear();
    await this.prisma.$disconnect();
  }
}
