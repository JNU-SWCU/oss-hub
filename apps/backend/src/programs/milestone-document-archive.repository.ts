import { Injectable } from '@nestjs/common';
import { ApplicationStatus, SubmissionStatus } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { USER_PROFILE_NAME_SELECT } from '../platform/user-profile-read.config';
export interface MilestoneDocumentArchiveDocument {
  readonly id: string;
  readonly name: string;
  readonly required: boolean;
}
export interface ArchiveProgram {
  readonly name: string;
  readonly milestones: readonly {
    readonly id: string;
    readonly name: string;
    readonly dueAt: Date;
    readonly documents: readonly MilestoneDocumentArchiveDocument[];
  }[];
}
export interface MilestoneDocumentArchiveTeam {
  readonly teamId: string;
  readonly teamName: string;
  readonly applicantName: string | null;
  readonly memberNicknames: readonly string[];
}
export interface MilestoneDocumentArchiveSubmission {
  readonly teamId: string;
  readonly milestoneDocumentId: string;
  readonly submittedAt: Date;
  readonly status: SubmissionStatus;
  readonly content: unknown;
  readonly hasCurrentFileEvidence: boolean;
  readonly file: {
    readonly storageKey: string;
    readonly originalFileName: string;
    readonly sizeBytes: number;
  } | null;
}
export interface ProgramArchiveReader {
  findProgram(programId: string): Promise<ArchiveProgram | null>;
  findApprovedTeams(
    programId: string,
    teamId?: string,
  ): Promise<readonly MilestoneDocumentArchiveTeam[]>;
}
@Injectable()
export class MilestoneDocumentArchiveRepository implements ProgramArchiveReader {
  constructor(private readonly prisma: PrismaService) {}
  async findProgram(programId: string): Promise<ArchiveProgram | null> {
    return this.prisma.program.findUnique({
      where: { id: programId, lifecycle: { not: 'DELETED' } },
      select: {
        name: true,
        milestones: {
          orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            name: true,
            dueAt: true,
            documents: {
              where: {},
              orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
              select: { id: true, name: true, required: true },
            },
          },
        },
      },
    });
  }
  async findApprovedTeams(
    programId: string,
    teamId?: string,
  ): Promise<readonly MilestoneDocumentArchiveTeam[]> {
    const applications = await this.prisma.team.findMany({
      where: {
        programId,
        status: ApplicationStatus.APPROVED,
        ...(teamId === undefined ? {} : { teamId }),
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        applicant: { select: USER_PROFILE_NAME_SELECT },
        name: true,
        members: {
          orderBy: { createdAt: 'asc' },
          select: { user: { select: { nickname: true } } },
        },
      },
    });
    return applications.map((application) => ({
      teamId: application.id,
      teamName: application.name,
      applicantName: application.applicant.name ?? null,
      memberNicknames: application.members.map(
        (member) => member.user.nickname,
      ),
    }));
  }
}
