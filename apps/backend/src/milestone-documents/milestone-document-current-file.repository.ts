import { Inject, Injectable } from '@nestjs/common';
import {
  AccountStatus,
  ApplicationStatus,
  MilestoneSubmissionType,
  Prisma,
  Role,
  SubmissionFileLifecycle,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const currentFileSelect = {
  files: {
    select: {
      storageKey: true,
      originalFileName: true,
      mimeType: true,
      sizeBytes: true,
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
      role: Role.STUDENT,
    } as const;
    const submission = await this.prisma.milestoneDocumentSubmission.findFirst({
      where: {
        milestoneDocumentId: documentId,
        milestoneDocument: {
          is: {
            milestoneId,
            submissionType: MilestoneSubmissionType.FILE,
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
        files: {
          where: {
            lifecycle: SubmissionFileLifecycle.ATTACHED,
            expiresAt: { gt: new Date() },
          },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: currentFileSelect.files.select,
        },
      },
    });
    return submission?.files[0] ?? null;
  }
}
