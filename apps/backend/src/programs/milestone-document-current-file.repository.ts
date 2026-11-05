import { FileMetadataRepository } from './files.repository';
import { Inject, Injectable } from '@nestjs/common';
import { AccountStatus, Prisma, FileLifecycle } from '@prisma/client';
import { STUDENT_MEMBER_WHERE } from '../platform/user-profile-read.config';
import { PrismaService } from '../platform/prisma.service';

const currentFileSelect = {
  revision: true,
  files: {
    select: {
      storageKey: true,
      originalFileName: true,
      mimeType: true,
      sizeBytes: true,
      submissionHistory: { select: { revision: true } },
    },
  },
} satisfies Prisma.MilestoneDocumentSubmissionSelect;

type CurrentFileRow = Prisma.MilestoneDocumentSubmissionGetPayload<{
  select: typeof currentFileSelect;
}>;

interface CurrentFilePrisma {
  readonly milestoneDocumentSubmission: {
    findFirst(
      args: Prisma.MilestoneDocumentSubmissionFindFirstArgs,
    ): Promise<CurrentFileRow | null>;
  };
}

export interface CurrentMilestoneDocumentFile {
  readonly storageKey: string;
  readonly originalFileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
}

export interface MilestoneDocumentCurrentFileReader {
  findForParticipant(
    sessionGithubId: bigint,
    milestoneId: string,
    documentId: string,
  ): Promise<CurrentMilestoneDocumentFile | null>;
}

@Injectable()
export class MilestoneDocumentCurrentFileRepository implements MilestoneDocumentCurrentFileReader {
  constructor(
    @Inject(PrismaService) private readonly prisma: CurrentFilePrisma,
    private readonly fileMetadata: FileMetadataRepository,
  ) {}

  async findForParticipant(
    sessionGithubId: bigint,
    milestoneId: string,
    documentId: string,
  ): Promise<CurrentMilestoneDocumentFile | null> {
    const activeStudent = {
      githubId: sessionGithubId,
      accountStatus: AccountStatus.ACTIVE,
      ...STUDENT_MEMBER_WHERE,
    } satisfies Prisma.UserWhereInput;
    const submission = await this.prisma.milestoneDocumentSubmission.findFirst({
      where: {
        milestoneDocumentId: documentId,
        milestoneDocument: {
          is: {
            milestoneId,
          },
        },
        team: {
          is: {
            program: { is: { milestones: { some: { id: milestoneId } } } },
            members: { some: { user: { is: activeStudent } } },
          },
        },
      },
      select: {
        revision: true,
        files: {
          where: {
            lifecycle: FileLifecycle.ATTACHED,
            expiresAt: { gt: new Date() },
          },
          orderBy: [
            {
              submissionHistory: {
                revision: { sort: 'desc', nulls: 'last' },
              },
            },
            { createdAt: 'desc' },
          ],
          take: 1,
          select: currentFileSelect.files.select,
        },
      },
    });
    const rawFile = submission?.files[0];
    const file =
      rawFile === undefined ? undefined : this.fileMetadata.read(rawFile);
    if (
      submission == null ||
      file == null ||
      file.submissionHistory?.revision !== submission.revision
    ) {
      return null;
    }
    return {
      storageKey: file.storageKey,
      originalFileName: file.originalFileName,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
    };
  }
}
