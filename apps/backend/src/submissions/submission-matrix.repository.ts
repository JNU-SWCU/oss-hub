import { Injectable } from '@nestjs/common';
import {
  AccountStatus,
  ApplicationStatus,
  Prisma,
  Role,
  type SubmissionStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  compatibleProfileNameWhere,
  COMPATIBLE_PROFILE_NAME_SELECT,
  resolveCompatibleProfileName,
} from '../profiles/profile-compatibility';
import type { SubmissionMatrixFilter } from './domain/submission-matrix';

export interface SubmissionMatrixViewer {
  readonly id: string;
}

export interface MatrixMilestoneRecord {
  readonly id: string;
  readonly name: string;
  readonly dueAt: Date;
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
  readonly applicationId: string;
  readonly milestoneId: string;
  readonly status: SubmissionStatus;
  readonly currentRevision: number;
  /** 최신 revision의 생성 시각. revision row가 없으면(비정상 데이터) null. */
  readonly submittedAt: Date | null;
}

export interface MatrixApplicationPage {
  readonly items: readonly MatrixApplicationRecord[];
  readonly total: number;
}

export interface SubmissionMatrixRepositoryPort {
  findActiveStaffOrAdmin(
    githubId: bigint,
  ): Promise<SubmissionMatrixViewer | null>;
  programExists(programId: string): Promise<boolean>;
  findMilestones(programId: string): Promise<readonly MatrixMilestoneRecord[]>;
  findApprovedApplications(
    programId: string,
    filter: SubmissionMatrixFilter,
    skip: number,
    take: number,
  ): Promise<MatrixApplicationPage>;
  findCurrentSubmissions(
    applicationIds: readonly string[],
  ): Promise<readonly MatrixSubmissionRecord[]>;
}

/**
 * 승인 Application 전수 행 + 검색·형태 필터 — rows와 count가 같은 where를 공유한다(#124).
 * q는 신청자 이름·신청자 GitHub 핸들·팀명·팀원 GitHub 핸들을 대소문자 무시 contains로 찾는다.
 */
export function submissionMatrixApplicationWhere(
  programId: string,
  filter: SubmissionMatrixFilter,
): Prisma.ApplicationWhereInput {
  const where: Prisma.ApplicationWhereInput = {
    programId,
    status: ApplicationStatus.APPROVED,
  };
  // 참여 유형(개인형/팀형) 필터는 D6로 폐지됐다 — 모든 신청이 Team을 갖고 개인 참여는
  // 1인 팀이라 teamId로는 더 이상 구분되지 않는다. 조용히 0건을 반환하는 필터를
  // 남기지 않기 위해 여기서 제거한다.
  if (filter.q.length > 0) {
    const contains = { contains: filter.q, mode: 'insensitive' as const };
    where.OR = [
      { applicant: compatibleProfileNameWhere(filter.q) },
      { applicant: { nickname: contains } },
      { team: { name: contains } },
      { team: { members: { some: { user: { nickname: contains } } } } },
    ];
  }
  return where;
}

const matrixApplicationSelect = {
  id: true,
  applicant: {
    select: {
      nickname: true,
      ...COMPATIBLE_PROFILE_NAME_SELECT,
    },
  },
  team: {
    select: {
      name: true,
      members: {
        orderBy: { createdAt: 'asc' },
        select: { user: { select: { nickname: true } } },
      },
    },
  },
} as const;

type MatrixApplicationRow = Prisma.ApplicationGetPayload<{
  select: typeof matrixApplicationSelect;
}>;

function toMatrixApplication(
  application: MatrixApplicationRow,
): MatrixApplicationRecord {
  return {
    id: application.id,
    applicant: {
      name: resolveCompatibleProfileName(application.applicant),
      nickname: application.applicant.nickname,
    },
    team: application.team
      ? {
          name: application.team.name,
          memberNicknames: application.team.members.map(
            (member) => member.user.nickname,
          ),
        }
      : null,
  };
}

@Injectable()
export class SubmissionMatrixRepository implements SubmissionMatrixRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  findActiveStaffOrAdmin(
    githubId: bigint,
  ): Promise<SubmissionMatrixViewer | null> {
    return this.prisma.user.findFirst({
      where: {
        githubId,
        accountStatus: AccountStatus.ACTIVE,
        role: { in: [Role.STAFF, Role.ADMIN] },
      },
      select: { id: true },
    });
  }

  async programExists(programId: string): Promise<boolean> {
    const program = await this.prisma.program.findUnique({
      where: { id: programId },
      select: { id: true },
    });
    return program !== null;
  }

  findMilestones(programId: string): Promise<readonly MatrixMilestoneRecord[]> {
    return this.prisma.milestone.findMany({
      where: { programId },
      orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, name: true, dueAt: true },
    });
  }

  async findApprovedApplications(
    programId: string,
    filter: SubmissionMatrixFilter,
    skip: number,
    take: number,
  ): Promise<MatrixApplicationPage> {
    const where = submissionMatrixApplicationWhere(programId, filter);
    const [applications, total] = await Promise.all([
      this.prisma.application.findMany({
        where,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip,
        take,
        select: matrixApplicationSelect,
      }),
      this.prisma.application.count({ where }),
    ]);
    return { items: applications.map(toMatrixApplication), total };
  }

  async findCurrentSubmissions(
    applicationIds: readonly string[],
  ): Promise<readonly MatrixSubmissionRecord[]> {
    if (applicationIds.length === 0) return [];
    const submissions = await this.prisma.submission.findMany({
      where: { applicationId: { in: [...applicationIds] } },
      select: {
        id: true,
        applicationId: true,
        milestoneId: true,
        status: true,
        currentRevision: true,
        revisions: {
          orderBy: { revision: 'desc' },
          take: 1,
          select: { submittedAt: true },
        },
      },
    });
    return submissions.map((submission) => ({
      id: submission.id,
      applicationId: submission.applicationId,
      milestoneId: submission.milestoneId,
      status: submission.status,
      currentRevision: submission.currentRevision,
      submittedAt: submission.revisions[0]?.submittedAt ?? null,
    }));
  }
}
