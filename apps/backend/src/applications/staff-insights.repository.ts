import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface StaffInsightsStudentRecord {
  readonly id: string;
  readonly githubId: bigint;
  readonly department: string | null;
}

export interface StaffInsightsParticipationRecord {
  readonly programId: string;
  readonly programName: string;
  readonly userIds: readonly string[];
}

@Injectable()
export class StaffInsightsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listStudents(): Promise<readonly StaffInsightsStudentRecord[]> {
    const rows = await this.prisma.user.findMany({
      where: { role: 'STUDENT', accountStatus: 'ACTIVE' },
      select: {
        id: true,
        githubId: true,
        department: true,
        profile: { select: { department: true } },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      githubId: row.githubId,
      department: row.profile?.department ?? row.department,
    }));
  }

  async listApprovedParticipations(): Promise<
    readonly StaffInsightsParticipationRecord[]
  > {
    const rows = await this.prisma.application.findMany({
      where: { status: 'APPROVED' },
      select: {
        programId: true,
        applicantId: true,
        program: { select: { name: true } },
        team: { select: { members: { select: { userId: true } } } },
      },
    });
    return rows.map((row) => {
      const memberIds = row.team.members.map((member) => member.userId);
      return {
        programId: row.programId,
        programName: row.program.name,
        userIds: [...new Set([row.applicantId, ...memberIds])],
      };
    });
  }
}
