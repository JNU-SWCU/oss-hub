import { Injectable } from '@nestjs/common';
import { ApplicationStatus, MilestoneDocumentKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  resolveUserProfileName,
  USER_PROFILE_NAME_SELECT,
} from '../prisma/user-profile-read';
import type {
  ArchiveProgram,
  MilestoneDocumentArchiveTeam,
} from './domain/milestone-document-archive';

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
