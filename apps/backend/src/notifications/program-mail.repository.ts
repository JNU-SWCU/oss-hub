import { Inject, Injectable } from '@nestjs/common';
import { AccountStatus, ApplicationStatus, type Prisma } from '@prisma/client';
import { READ_CAP } from '../platform/bounded-read.config';
import { BoundedReadRepository } from '../platform/bounded-read.repository';
import { PrismaService } from '../platform/prisma.service';

export type ProgramMailApplicant = {
  readonly id: string;
  readonly displayName: string;
  readonly nickname: string;
  readonly notificationEmail: string | null;
  readonly mailAvailable: boolean;
};

type ProgramMailTeam = {
  readonly id: string;
  readonly name: string;
  readonly status: ApplicationStatus;
  readonly deadlineEligible: boolean;
  readonly applicants: readonly ProgramMailApplicant[];
};

export type ProgramMailAudience = {
  readonly id: string;
  readonly name: string;
  readonly teams: readonly ProgramMailTeam[];
};

export interface ProgramMailRepositoryPort {
  findAudience(
    programId: string,
    window: { readonly from: Date; readonly to: Date },
  ): Promise<ProgramMailAudience | null>;
}

const applicantSelect = {
  id: true,
  name: true,
  nickname: true,
  notificationEmail: true,
  notifyEnabled: true,
  accountStatus: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class ProgramMailRepository implements ProgramMailRepositoryPort {
  private readonly boundedReads = new BoundedReadRepository();

  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
  ) {}

  async findAudience(
    programId: string,
    window: { readonly from: Date; readonly to: Date },
  ): Promise<ProgramMailAudience | null> {
    const program = await this.prisma.program
      .findUnique({
        where: { id: programId, lifecycle: { not: 'DELETED' } },
        select: {
          id: true,
          name: true,
          milestones: {
            take: READ_CAP.milestonesPerProgram + 1,
            where: { dueAt: { gte: window.from, lte: window.to } },
            select: {
              requirements: {
                take: READ_CAP.requirementsPerMilestone + 1,
                where: { required: true },
                select: { id: true },
                orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
              },
            },
            orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
          },
          teams: {
            take: READ_CAP.teamsPerProgram + 1,
            where: { archivedAt: null },
            select: {
              id: true,
              name: true,
              status: true,
              applicant: { select: applicantSelect },
              members: {
                take: READ_CAP.membersPerTeam + 1,
                select: { user: { select: applicantSelect } },
                orderBy: { userId: 'asc' },
              },
              submissions: {
                take: READ_CAP.requirementsPerProgram + 1,
                select: { requirementId: true },
                orderBy: { requirementId: 'asc' },
              },
            },
            orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }],
          },
        },
      })
      .then((result) =>
        this.boundedReads.assertNestedWithin(
          result,
          {
            milestones: {
              cap: READ_CAP.milestonesPerProgram,
              nested: { requirements: READ_CAP.requirementsPerMilestone },
            },
            teams: {
              cap: READ_CAP.teamsPerProgram,
              nested: {
                members: READ_CAP.membersPerTeam,
                submissions: READ_CAP.requirementsPerProgram,
              },
            },
          },
          'Program.findUnique',
        ),
      );
    if (program === null) return null;

    const requiredDocumentIds = new Set(
      program.milestones.flatMap((milestone) =>
        milestone.requirements.map((requirement) => requirement.id),
      ),
    );
    return {
      id: program.id,
      name: program.name,
      teams: program.teams.map((team) => {
        const submitted = new Set(
          team.submissions.map((submission) => submission.requirementId),
        );
        const applicants = new Map(
          [team.applicant, ...team.members.map((member) => member.user)].map(
            (applicant) => [
              applicant.id,
              {
                id: applicant.id,
                displayName: applicant.name ?? applicant.nickname,
                nickname: applicant.nickname,
                notificationEmail: applicant.notificationEmail,
                mailAvailable:
                  applicant.accountStatus === AccountStatus.ACTIVE &&
                  applicant.notifyEnabled &&
                  applicant.notificationEmail !== null,
              },
            ],
          ),
        );
        return {
          id: team.id,
          name: team.name,
          status: team.status,
          deadlineEligible:
            team.status === ApplicationStatus.APPROVED &&
            requiredDocumentIds.size > 0 &&
            [...requiredDocumentIds].some((id) => !submitted.has(id)),
          applicants: [...applicants.values()],
        };
      }),
    };
  }
}
