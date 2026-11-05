import { Prisma, ApplicationStatus, SubmissionStatus } from '@prisma/client';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../platform/prisma.service';
import { USER_PROFILE_NAME_SELECT } from '../platform/user-profile-read.config';
import { MATRIX_APPLICATION_MODES } from './submission-matrix.config';
import { PlatformRepository } from '../platform/platform.repository';
export type MatrixApplicationMode = (typeof MATRIX_APPLICATION_MODES)[number];
export interface SubmissionMatrixFilter {
  readonly q: string;
  readonly applicationMode: MatrixApplicationMode | null;
}
export interface MatrixDocumentFirstSubmission {
  readonly teamId: string;
  readonly milestoneDocumentId: string;
  readonly firstSubmittedAt: Date;
}
async function findMatrixDocumentFirstSubmissions(
  prisma: Prisma.TransactionClient,
  scope: {
    readonly teamIds: readonly string[];
    readonly documentIds: readonly string[];
  },
): Promise<readonly MatrixDocumentFirstSubmission[]> {
  if (scope.teamIds.length === 0 || scope.documentIds.length === 0) {
    return [];
  }
  const submissions = await prisma.milestoneDocumentSubmission.findMany({
    where: {
      teamId: { in: [...scope.teamIds] },
      milestoneDocumentId: { in: [...scope.documentIds] },
    },
    select: {
      teamId: true,
      milestoneDocumentId: true,
      createdAt: true,
      histories: {
        where: { event: 'SUBMITTED', revision: 1 },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 1,
        select: { createdAt: true },
      },
    },
  });
  return submissions.map((submission) => ({
    teamId: submission.teamId,
    milestoneDocumentId: submission.milestoneDocumentId,
    firstSubmittedAt:
      submission.histories[0]?.createdAt ?? submission.createdAt,
  }));
}
export interface MatrixMilestoneRecord {
  readonly id: string;
  readonly name: string;
  readonly dueAt: Date;
  readonly requiredDocumentIds: readonly string[];
}
export interface MatrixApplicationRecord {
  readonly id: string;
  readonly applicant: {
    readonly name: string | null;
    readonly nickname: string;
  };
  readonly team: {
    readonly name: string;
    readonly memberNicknames: readonly string[];
  } | null;
}
export interface MatrixSubmissionRecord {
  readonly id: string;
  readonly teamId: string;
  readonly milestoneId: string;
  readonly milestoneDocumentId: string;
  readonly status: SubmissionStatus;
  readonly currentRevision: number;
  readonly submittedAt: Date | null;
}
export interface MatrixApplicationPage {
  readonly items: readonly MatrixApplicationRecord[];
  readonly total: number;
}
export interface SubmissionMatrixRepositoryPort {
  programExists(programId: string): Promise<boolean>;
  findMilestones(programId: string): Promise<readonly MatrixMilestoneRecord[]>;
  findApprovedApplications(
    programId: string,
    filter: SubmissionMatrixFilter,
    skip: number,
    take: number,
  ): Promise<MatrixApplicationPage>;
  findCurrentSubmissions(
    teamIds: readonly string[],
  ): Promise<readonly MatrixSubmissionRecord[]>;
  findDocumentFirstSubmissions(
    teamIds: readonly string[],
    documentIds: readonly string[],
  ): Promise<readonly MatrixDocumentFirstSubmission[]>;
  findDocumentChangeRequests(
    teamIds: readonly string[],
  ): Promise<readonly MatrixDocumentChangeRequest[]>;
}
export interface MatrixDocumentChangeRequest {
  readonly teamId: string;
  readonly milestoneId: string;
}
const matrixApplicationSelect = {
  id: true,
  applicant: {
    select: {
      nickname: true,
      ...USER_PROFILE_NAME_SELECT,
    },
  },
  name: true,
  members: {
    orderBy: { createdAt: 'asc' },
    select: { user: { select: { nickname: true } } },
  },
} satisfies Prisma.TeamSelect;
type MatrixApplicationRow = Prisma.TeamGetPayload<{
  select: typeof matrixApplicationSelect;
}>;
function toMatrixApplication(
  application: MatrixApplicationRow,
): MatrixApplicationRecord {
  return {
    id: application.id,
    applicant: {
      name: application.applicant.name ?? null,
      nickname: application.applicant.nickname,
    },
    team: {
      name: application.name,
      memberNicknames: application.members.map(
        (member) => member.user.nickname,
      ),
    },
  };
}
@Injectable()
export class SubmissionMatrixRepository implements SubmissionMatrixRepositoryPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly platformRepository: PlatformRepository,
  ) {}
  async programExists(programId: string): Promise<boolean> {
    const program = await this.prisma.program.findUnique({
      where: { id: programId },
      select: { id: true },
    });
    return program !== null;
  }
  async findMilestones(
    programId: string,
  ): Promise<readonly MatrixMilestoneRecord[]> {
    const milestones = await this.prisma.milestone.findMany({
      where: { programId },
      orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        name: true,
        dueAt: true,
        documents: {
          where: { required: true },
          select: { id: true },
        },
      },
    });
    return milestones.map(({ documents, ...milestone }) => ({
      ...milestone,
      requiredDocumentIds: documents.map((document) => document.id),
    }));
  }
  findDocumentFirstSubmissions(
    teamIds: readonly string[],
    documentIds: readonly string[],
  ): Promise<readonly MatrixDocumentFirstSubmission[]> {
    return findMatrixDocumentFirstSubmissions(this.prisma, {
      teamIds,
      documentIds,
    });
  }
  async findApprovedApplications(
    programId: string,
    filter: SubmissionMatrixFilter,
    skip: number,
    take: number,
  ): Promise<MatrixApplicationPage> {
    const where = this.submissionMatrixApplicationWhere(programId, filter);
    const [applications, total] = await Promise.all([
      this.prisma.team.findMany({
        where,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip,
        take,
        select: matrixApplicationSelect,
      }),
      this.prisma.team.count({ where }),
    ]);
    return { items: applications.map(toMatrixApplication), total };
  }
  async findDocumentChangeRequests(
    teamIds: readonly string[],
  ): Promise<readonly MatrixDocumentChangeRequest[]> {
    if (teamIds.length === 0) return [];
    const submissions = await this.prisma.milestoneDocumentSubmission.findMany({
      where: {
        teamId: { in: [...teamIds] },
        status: SubmissionStatus.CHANGES_REQUESTED,
        milestoneDocument: {},
      },
      select: {
        teamId: true,
        milestoneDocument: { select: { milestoneId: true } },
      },
    });
    return submissions.map((submission) => ({
      teamId: submission.teamId,
      milestoneId: submission.milestoneDocument.milestoneId,
    }));
  }
  async findCurrentSubmissions(
    teamIds: readonly string[],
  ): Promise<readonly MatrixSubmissionRecord[]> {
    if (teamIds.length === 0) return [];
    const submissions = await this.prisma.milestoneDocumentSubmission.findMany({
      where: {
        teamId: { in: [...teamIds] },
        milestoneDocument: { required: true },
      },
      select: {
        id: true,
        milestoneDocumentId: true,
        teamId: true,
        status: true,
        revision: true,
        submittedAt: true,
        milestoneDocument: { select: { milestoneId: true } },
      },
    });
    return submissions.map((submission) => ({
      id: submission.id,
      teamId: submission.teamId,
      milestoneId: submission.milestoneDocument.milestoneId,
      milestoneDocumentId: submission.milestoneDocumentId,
      status: submission.status,
      currentRevision: submission.revision,
      submittedAt: submission.submittedAt,
    }));
  }
  submissionMatrixApplicationWhere(
    programId: string,
    filter: SubmissionMatrixFilter,
  ): Prisma.TeamWhereInput {
    const where: Prisma.TeamWhereInput = {
      programId,
      status: ApplicationStatus.APPROVED,
    };
    if (filter.q.length > 0) {
      const contains = { contains: filter.q, mode: 'insensitive' as const };
      where.OR = [
        { applicant: this.platformRepository.userProfileNameWhere(filter.q) },
        { applicant: { nickname: contains } },
        { name: contains },
        { members: { some: { user: { nickname: contains } } } },
      ];
    }
    return where;
  }
}
