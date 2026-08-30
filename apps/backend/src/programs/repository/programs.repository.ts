import { Injectable } from '@nestjs/common';
import type { Program } from '@prisma/client';
import {
  ApplicationStatus,
  MilestoneDocumentKind,
  Prisma,
  ProgramCategory,
  StaffAccessRequestStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  USER_PROFILE_NAME_SELECT,
  resolveUserProfileName,
} from '../../profiles/user-profile-read';
import {
  projectSubmissionCompletionTargets,
  submissionCompletionTargetSelect,
  type SubmissionCompletionTargetRow,
} from '../../submissions/submission-completion-projection';
import type { ProgramListQuery } from '../program-list-query';
import {
  emptyProgramStatusCounts,
  programListOrderBySql,
  programListPrismaWhere,
  programListSqlWhere,
  programStatusCountsSql,
  type ProgramStatusCounts,
} from '../program-list-status-filter';
import { programApplicationParticipantWhere } from '../program-participant';

export type { ProgramStatusCounts };
export type ProgramListRecord = Pick<
  Program,
  | 'id'
  | 'name'
  | 'organizer'
  | 'category'
  | 'lifecycle'
  | 'applicationStartAt'
  | 'applicationEndAt'
  | 'endAt'
  | 'description'
  | 'teamMinSize'
  | 'teamMaxSize'
>;

/** GET /programs 뷰어 개인화 배치 조회 결과. */
export interface ProgramApplicationCounts {
  readonly total: number;
  readonly pending: number;
}

@Injectable()
export class ProgramsRepository {
  constructor(private readonly prisma: PrismaService) {}

  listPrograms(query: ProgramListQuery, now: Date) {
    const where: Prisma.ProgramWhereInput = {
      ...programListPrismaWhere(query.status, now),
      ...(query.search
        ? { name: { contains: query.search, mode: 'insensitive' as const } }
        : {}),
    };
    const sqlWhere = programListSqlWhere(query.status, query.search, now);
    const orderBy = programListOrderBySql(query.sort, query.direction, now);
    const offset = (query.page - 1) * query.pageSize;
    return this.prisma.$transaction([
      this.prisma.$queryRaw<readonly ProgramListRecord[]>(Prisma.sql`
        SELECT
          p."id",
          p."name",
          p."organizer",
          p."category",
          p."lifecycle",
          p."applicationStartAt",
          p."applicationEndAt",
          p."endAt",
          p."description",
          p."teamMinSize",
          p."teamMaxSize"
        FROM "Program" AS p
        ${sqlWhere}
        ORDER BY ${orderBy}
        LIMIT ${query.pageSize}
        OFFSET ${offset}
      `),
      this.prisma.program.count({ where }),
    ]);
  }

  /**
   * 공개 목록 status 필터와 동일 규칙의 5키 카운트.
   * 목록 `totalItems` 와 키가 항상 일치해야 사이드바 뱃지가 신뢰된다.
   */
  async countProgramsByStatus(now: Date): Promise<ProgramStatusCounts> {
    const rows = await this.prisma.$queryRaw<
      readonly {
        readonly all: number;
        readonly recruiting: number;
        readonly in_progress: number;
        readonly upcoming: number;
        readonly ended: number;
      }[]
    >(programStatusCountsSql(now));
    const row = rows[0];
    if (!row) return emptyProgramStatusCounts();
    return {
      all: row.all,
      recruiting: row.recruiting,
      in_progress: row.in_progress,
      upcoming: row.upcoming,
      ended: row.ended,
    };
  }

  findProgramDetail(programId: string) {
    return this.prisma.program.findUnique({
      where: { id: programId },
      select: {
        lifecycle: true,
        id: true,
        name: true,
        organizer: true,
        category: true,
        description: true,
        repositoryProvisioningEnabled: true,
        applicationStartAt: true,
        applicationEndAt: true,
        startAt: true,
        endAt: true,
        milestones: {
          orderBy: [{ dueAt: 'asc' as const }, { createdAt: 'asc' as const }],
          select: {
            id: true,
            name: true,
            startAt: true,
            dueAt: true,
            instructions: true,
            submissionType: true,
            _count: {
              select: {
                documents: {
                  where: { kind: MilestoneDocumentKind.DOCUMENT },
                },
              },
            },
            // ⚠ 필수 서류만 — 선택 서류가 섞이면 안 낸 선택 서류가 진행을 0으로 잡아 둔다.
            documents: {
              where: {
                required: true,
                kind: MilestoneDocumentKind.DOCUMENT,
              },
              select: { id: true },
            },
          },
        },
      },
    });
  }

  async findStudentApplication(programId: string, userId: string) {
    const application = await this.prisma.application.findFirst({
      where: {
        programId,
        ...programApplicationParticipantWhere(userId),
      },
      select: {
        id: true,
        status: true,
        milestoneDocumentSubmissions: {
          select: submissionCompletionTargetSelect,
        },
      },
    });
    return application ? toTargetSubmissionAxes(application) : null;
  }

  async findApprovedApplications(programId: string) {
    const applications = await this.prisma.application.findMany({
      where: { programId, status: ApplicationStatus.APPROVED },
      select: {
        milestoneDocumentSubmissions: {
          select: submissionCompletionTargetSelect,
        },
      },
    });
    return applications.map(toTargetSubmissionAxes);
  }

  /**
   * 목록 뷰어(학생) 개인화 배치 조회 — programId in (...) 한 번으로 N+1을 피한다.
   * 신청자 본인뿐 아니라 팀장/팀원으로 참여한 신청도 포함한다(상세 화면과 동일 규칙).
   */
  async findViewerApplicationStatuses(
    programIds: readonly string[],
    userId: string,
  ): Promise<ReadonlyMap<string, ApplicationStatus>> {
    if (programIds.length === 0) return new Map();
    const applications = await this.prisma.application.findMany({
      where: {
        programId: { in: [...programIds] },
        ...programApplicationParticipantWhere(userId),
      },
      select: { programId: true, status: true },
    });
    return new Map(
      applications.map((application) => [
        application.programId,
        application.status,
      ]),
    );
  }

  /**
   * 목록 뷰어(교직원) 개인화 배치 조회 — programId in (...) + status groupBy 한 번.
   * pending 은 SUBMITTED(승인 대기) 건수, total 은 상태 무관 전체 건수다.
   */
  async countApplicationsByProgram(
    programIds: readonly string[],
  ): Promise<ReadonlyMap<string, ProgramApplicationCounts>> {
    if (programIds.length === 0) return new Map();
    const rows = await this.prisma.application.groupBy({
      by: ['programId', 'status'],
      where: { programId: { in: [...programIds] } },
      _count: { _all: true },
    });
    const counts = new Map<string, { total: number; pending: number }>();
    for (const row of rows) {
      const bucket = counts.get(row.programId) ?? { total: 0, pending: 0 };
      bucket.total += row._count._all;
      if (row.status === ApplicationStatus.SUBMITTED) {
        bucket.pending += row._count._all;
      }
      counts.set(row.programId, bucket);
    }
    return counts;
  }

  async findProgramRepositories(
    programId: string,
    studentUserId: string | null,
  ) {
    const repositories = await this.prisma.githubRepository.findMany({
      where: {
        programId,
        ...(studentUserId
          ? {
              application: {
                ...programApplicationParticipantWhere(studentUserId),
              },
            }
          : {}),
      },
      select: {
        githubRepositoryId: true,
        application: {
          select: {
            id: true,
            applicant: {
              select: {
                githubId: true,
                nickname: true,
                ...USER_PROFILE_NAME_SELECT,
              },
            },
            team: {
              select: {
                name: true,
                leader: { select: { githubId: true } },
                members: { select: { user: { select: { githubId: true } } } },
              },
            },
          },
        },
      },
    });
    // programId로 걸러진 행은 항상 provisioning이 만든 행이라 application을 갖는다 —
    // 인벤토리 스윕이 만든 행(programId null)은 이 where절에 애초에 매칭되지 않는다.
    return repositories
      .filter((repository) => repository.application !== null)
      .map((repository) => ({
        githubRepositoryId: repository.githubRepositoryId,
        application: {
          id: repository.application!.id,
          applicant: {
            githubId: repository.application!.applicant.githubId,
            nickname: repository.application!.applicant.nickname,
            name: resolveUserProfileName(repository.application!.applicant),
          },
          team: repository.application!.team,
        },
      }));
  }

  async findStudentActivityApplications(userId: string) {
    return this.prisma.application.findMany({
      where: {
        status: ApplicationStatus.APPROVED,
        ...programApplicationParticipantWhere(userId),
      },
      select: {
        teamId: true,
        applicant: { select: { githubId: true } },
        team: {
          select: {
            leader: { select: { githubId: true } },
            members: {
              select: { user: { select: { githubId: true } } },
            },
          },
        },
        program: {
          select: { id: true, name: true, applicationStartAt: true },
        },
        repository: { select: { githubRepositoryId: true } },
      },
    });
  }

  findViewer(githubId: bigint) {
    return this.prisma.user.findUnique({
      where: { githubId },
      select: {
        id: true,
        accountStatus: true,
        hasStaffAccess: true,
        hasAdminAccess: true,
        profile: { select: { memberKind: true } },
        staffAccessRequests: {
          where: { status: StaffAccessRequestStatus.PENDING },
          select: { id: true },
          take: 1,
        },
      },
    });
  }

  findCreatorRole(githubId: bigint) {
    return this.prisma.user.findUnique({
      where: { githubId },
      select: {
        hasStaffAccess: true,
        hasAdminAccess: true,
        accountStatus: true,
      },
    });
  }

  withCreateTransaction<T>(
    operation: (
      writer: Pick<Prisma.TransactionClient, 'program' | 'auditLog'>,
    ) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction((transaction) => operation(transaction));
  }

  createProgram(
    data: {
      readonly name: string;
      readonly organizer: string;
      readonly category: ProgramCategory;
      readonly applicationTemplateKey: string;
      readonly applicationTemplateVersion: number;
      readonly applicationStartAt: Date;
      readonly applicationEndAt: Date;
      readonly startAt: Date;
      readonly endAt: Date;
      readonly teamMinSize: number;
      readonly teamMaxSize: number;
      readonly description: string;
    },
    writer: Pick<Prisma.TransactionClient, 'program'>,
  ) {
    return writer.program.create({ data });
  }
}

function toTargetSubmissionAxes<
  T extends {
    readonly milestoneDocumentSubmissions: readonly SubmissionCompletionTargetRow[];
  },
>(application: T) {
  const { submissions, documentSubmissions } =
    projectSubmissionCompletionTargets(
      application.milestoneDocumentSubmissions,
    );
  return {
    ...application,
    submissions,
    milestoneDocumentSubmissions: documentSubmissions,
  };
}
