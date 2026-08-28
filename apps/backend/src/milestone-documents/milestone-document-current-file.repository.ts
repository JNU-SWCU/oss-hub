import { Inject, Injectable } from '@nestjs/common';
import {
  AccountStatus,
  ApplicationStatus,
  Prisma,
  SubmissionFileLifecycle,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

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
} as const;

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
  findForApprovedParticipant(
    sessionGithubId: bigint,
    milestoneId: string,
    documentId: string,
  ): Promise<CurrentMilestoneDocumentFile | null>;
}

@Injectable()
export class MilestoneDocumentCurrentFileRepository implements MilestoneDocumentCurrentFileReader {
  constructor(
    @Inject(PrismaService) private readonly prisma: CurrentFilePrisma,
  ) {}

  async findForApprovedParticipant(
    sessionGithubId: bigint,
    milestoneId: string,
    documentId: string,
  ): Promise<CurrentMilestoneDocumentFile | null> {
    const activeStudent = {
      githubId: sessionGithubId,
      accountStatus: AccountStatus.ACTIVE,
      hasStaffAccess: false,
      hasAdminAccess: false,
    } as const;
    const submission = await this.prisma.milestoneDocumentSubmission.findFirst({
      where: {
        milestoneDocumentId: documentId,
        milestoneDocument: {
          is: {
            milestoneId,
          },
        },
        application: {
          is: {
            status: ApplicationStatus.APPROVED,
            program: { is: { milestones: { some: { id: milestoneId } } } },
            OR: [
              { applicant: { is: activeStudent } },
              { team: { is: { leader: { is: activeStudent } } } },
              {
                team: {
                  is: {
                    members: { some: { user: { is: activeStudent } } },
                  },
                },
              },
            ],
          },
        },
      },
      select: {
        revision: true,
        files: {
          where: {
            lifecycle: SubmissionFileLifecycle.ATTACHED,
            expiresAt: { gt: new Date() },
          },
          orderBy: [
            { submissionHistory: { revision: 'desc' } },
            { createdAt: 'desc' },
          ],
          take: 1,
          select: currentFileSelect.files.select,
        },
      },
    });
    const file = submission?.files[0];
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
