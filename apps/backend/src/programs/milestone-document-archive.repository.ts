import { Injectable } from '@nestjs/common';
import { ApplicationStatus, MilestoneDocumentKind } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import {
  USER_PROFILE_NAME_SELECT,
  UserProfileReadRepository,
} from '../platform/user-profile-read.repository';
import type {
  ArchiveProgram,
  MilestoneDocumentArchiveTeam,
} from './milestone-document-archive.policy';

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
      applicantName: UserProfileReadRepository.resolveUserProfileName(
        application.applicant,
      ),
      memberNicknames: application.team.members.map(
        (member) => member.user.nickname,
      ),
    }));
  }
}
