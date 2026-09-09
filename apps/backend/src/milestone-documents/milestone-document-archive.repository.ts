import { Injectable } from '@nestjs/common';
import { ApplicationStatus, MilestoneDocumentKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  resolveUserProfileName,
  USER_PROFILE_NAME_SELECT,
} from '../profiles/user-profile-read';
import type {
  MilestoneDocumentArchiveDocument,
  MilestoneDocumentArchiveTeam,
} from './domain/milestone-document-archive';

export interface ArchiveProgram {
  readonly name: string;
  readonly milestones: readonly {
    readonly id: string;
    readonly name: string;
    readonly dueAt: Date;
    readonly documents: readonly MilestoneDocumentArchiveDocument[];
  }[];
}

export interface ProgramArchiveReader {
  findProgram(programId: string): Promise<ArchiveProgram | null>;
  findApprovedTeams(
    programId: string,
    teamId?: string,
  ): Promise<readonly MilestoneDocumentArchiveTeam[]>;
}

/** 프로그램 안에서 선택한 다운로드 범위만 읽는다. 제출 이력은 조회하지 않는다. */
@Injectable()
export class MilestoneDocumentArchiveRepository implements ProgramArchiveReader {
  constructor(private readonly prisma: PrismaService) {}

  async findProgram(programId: string): Promise<ArchiveProgram | null> {
    return this.prisma.program.findUnique({
      where: { id: programId },
      select: {
        name: true,
        milestones: {
          orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            name: true,
            dueAt: true,
            documents: {
              where: { kind: MilestoneDocumentKind.DOCUMENT },
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
    const applications = await this.prisma.application.findMany({
      where: {
        programId,
        status: ApplicationStatus.APPROVED,
        team: { programId },
        ...(teamId === undefined ? {} : { teamId }),
      },
      orderBy: [{ team: { name: 'asc' } }, { id: 'asc' }],
      select: {
        id: true,
        applicant: { select: USER_PROFILE_NAME_SELECT },
        team: {
          select: {
            name: true,
            members: {
              orderBy: { createdAt: 'asc' },
              select: { user: { select: { nickname: true } } },
            },
          },
        },
      },
    });
    return applications.map((application) => ({
      applicationId: application.id,
      teamName: application.team.name,
      applicantName: resolveUserProfileName(application.applicant),
      memberNicknames: application.team.members.map(
        (member) => member.user.nickname,
      ),
    }));
  }
}
