import { Injectable } from '@nestjs/common';
import {
  type ApplicationStatus,
  MilestoneDocumentKind,
  type MilestoneSubmissionType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  submissionCompletionTargetSelect,
  type SubmissionCompletionTargetRow,
} from '../../submissions/domain/submission-completion-projection';
import { programApplicationParticipantWhere } from '../program-participant';

export interface StudentDashboardMilestoneRow {
  readonly id: string;
  readonly name: string;
  readonly dueAt: Date;
  readonly submissionType: MilestoneSubmissionType | null;
  readonly documents: readonly { readonly id: string }[];
}

export interface StudentDashboardApplicationRow {
  readonly id: string;
  readonly status: ApplicationStatus;
  readonly team: { readonly name: string };
  readonly program: {
    readonly id: string;
    readonly name: string;

    readonly cover?: {
      readonly id: string;
      readonly imageUrl?: string | null;
    } | null;
    readonly milestones: readonly StudentDashboardMilestoneRow[];
  };
  readonly milestoneDocumentSubmissions: readonly SubmissionCompletionTargetRow[];
}

export const studentDashboardApplicationSelect = {
  id: true,
  status: true,
  team: { select: { name: true } },
  program: {
    select: {
      cover: { select: { id: true, imageUrl: true } },
      id: true,
      name: true,
      milestones: {
        orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          name: true,
          dueAt: true,
          submissionType: true,

          documents: {
            where: { required: true, kind: MilestoneDocumentKind.DOCUMENT },
            select: { id: true },
          },
        },
      },
    },
  },

  milestoneDocumentSubmissions: { select: submissionCompletionTargetSelect },
} as const satisfies Prisma.ApplicationSelect;

@Injectable()
export class StudentDashboardReadRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findParticipatingApplications(
    sessionGithubId: bigint,
  ): Promise<readonly StudentDashboardApplicationRow[]> {
    const user = await this.prisma.user.findUnique({
      where: { githubId: sessionGithubId },
      select: { id: true },
    });
    if (user === null) return [];

    return this.prisma.application.findMany({
      where: programApplicationParticipantWhere(user.id),
      orderBy: [{ submittedAt: 'desc' }, { id: 'asc' }],
      select: studentDashboardApplicationSelect,
    });
  }
}
