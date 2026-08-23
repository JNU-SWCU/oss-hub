import { Inject, Injectable } from '@nestjs/common';
import {
  ApplicationStatus,
  RepositoryConnectionMode,
  RepositoryInvitationStatus,
  RepositoryProvisionJobStatus,
  SubmissionStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  USER_PROFILE_NAME_SELECT,
  resolveUserProfileName,
} from '../../profiles/user-profile-read';
import {
  REPOSITORIES_READ_PORT,
  type RepositoriesReadPort,
} from '../../github/repositories-read.port';

export interface StudentDashboardMilestone {
  readonly id: string;
  readonly name: string;
  readonly dueAt: Date;
  readonly submissionStatus:
    | 'NOT_SUBMITTED'
    | 'SUBMITTED'
    | 'APPROVED'
    | 'CHANGES_REQUESTED'
    | 'REJECTED';
}

export interface StudentDashboardItem {
  readonly applicationId: string;
  readonly programId: string;
  readonly programName: string;
  readonly applicationMode: 'PERSONAL' | 'TEAM';
  readonly displayName: string;
  readonly applicationStatus: 'SUBMITTED' | 'APPROVED' | 'REJECTED';
  readonly nextMilestone: StudentDashboardMilestone | null;
  readonly detailUrl: string;
  readonly checklistUrl: string;
  readonly repository: StudentDashboardRepository | null;
}

export interface StudentDashboardRepository {
  readonly repositoryName: string | null;
  readonly provisionStatus: 'NOT_STARTED' | RepositoryProvisionJobStatus;
  readonly invitationStatus: RepositoryInvitationStatus | null;
  readonly githubUrl: string | null;
}

function isNonEmptyString(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isSafeProgramId(value: string): boolean {
  return (
    value !== '.' &&
    value !== '..' &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
  );
}

/**
 * 카드의 「신청 상세」가 보낼 곳. **상태별로 학생이 알아야 할 것이 실제로 있는 화면**을 준다.
 *
 * `APPROVED`만 프로그램 상세(`/programs/{id}`)로 보낸다 — 판정이 끝나고 참여가 시작된
 * 뒤의 관심사는 신청서가 아니라 일정이기 때문이다.
 *
 * 그 밖(`SUBMITTED`·`REJECTED`)은 신청서 화면(`/programs/{id}/apply`)이다. 판정 전에는
 * 자기가 낸 답을, 판정 뒤에는 **반려 사유**를 그곳에서만 볼 수 있다. 사유가 실려 오는
 * 응답은 `GET programs/{id}/applications/me` 하나뿐이고 그 응답을 읽는 화면도 그 하나뿐이라,
 * 반려된 학생을 프로그램 상세로 보내면 상태도 사유도 없는 소개 문서 앞에 세우게 된다(#733).
 *
 * 규칙을 "APPROVED가 아니면 `/apply`"로 적는다 — frontend 검증기(`features/dashboard/api.ts`)가
 * 이 접미사를 **글자 그대로 대조**하므로 두 곳은 한 벌로 움직여야 한다. 같은 문장으로 적어
 * 두면 상태가 하나 늘어도 양쪽이 같은 쪽으로 갈려 어긋나지 않는다.
 *
 * ⚠ 어긋나면 **그 항목 하나만 빠지는 것이 아니다.** 검증기는 `items.every(...)`가 거짓이면
 * 던지고(`api.ts` 의 `parseStudentDashboard`), 로더가 그것을 잡아 `status: 'error'` 로 바꾼다
 * (`load-student-dashboard.ts`). 화면은 카드 목록 대신 「대시보드를 불러오지 못했습니다」 오류와
 * 재시도 버튼을 그린다 — 반려 한 건이 어긋나면 승인된 프로그램과 마일스톤까지 **전부** 사라진다.
 */
function detailUrlFor(status: ApplicationStatus, programId: string): string {
  const program = `/programs/${encodeURIComponent(programId)}`;
  return status === ApplicationStatus.APPROVED ? program : `${program}/apply`;
}

@Injectable()
export class StudentDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REPOSITORIES_READ_PORT)
    private readonly repositories: RepositoriesReadPort,
  ) {}

  async getStudentDashboard(
    sessionGithubId: bigint,
  ): Promise<readonly StudentDashboardItem[]> {
    const [applications, projectedRepositories] = await Promise.all([
      this.prisma.application.findMany({
        where: {
          // 모든 신청이 Team을 갖고 개인 참여는 1인 팀이므로(D5) 팀 소속 하나로 판정한다.
          team: {
            OR: [
              { leader: { githubId: sessionGithubId } },
              { members: { some: { user: { githubId: sessionGithubId } } } },
            ],
          },
        },
        orderBy: [{ submittedAt: 'desc' }, { id: 'asc' }],
        select: {
          id: true,
          status: true,
          teamId: true,
          applicant: {
            select: {
              nickname: true,
              ...USER_PROFILE_NAME_SELECT,
            },
          },
          team: {
            select: { name: true, _count: { select: { members: true } } },
          },
          program: {
            select: {
              id: true,
              name: true,
              milestones: {
                orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
                select: { id: true, name: true, dueAt: true },
              },
            },
          },
          submissions: { select: { milestoneId: true, status: true } },
        },
      }),
      this.repositories.getMyRepositories(sessionGithubId),
    ]);
    const repositoryByApplication = new Map(
      projectedRepositories.map((repository) => [
        repository.applicationId,
        repository,
      ]),
    );

    const items: StudentDashboardItem[] = [];
    for (const application of applications) {
      // 개인 참여는 멤버 1명뿐인 팀이다(D5). 팀 유무가 아니라 인원으로 가른다
      // (submission-matrix.service.ts isSoloTeam과 동일 규칙).
      const applicationMode =
        (application.team?._count.members ?? 0) > 1 ? 'TEAM' : 'PERSONAL';
      const displayName =
        applicationMode === 'TEAM'
          ? application.team?.name
          : (resolveUserProfileName(application.applicant) ??
            application.applicant.nickname);

      if (
        !isSafeProgramId(application.program.id) ||
        !isNonEmptyString(application.program.name) ||
        !isNonEmptyString(displayName)
      ) {
        continue;
      }

      const submissionStatuses = new Map(
        application.submissions.map((submission) => [
          submission.milestoneId,
          submission.status,
        ]),
      );
      const milestone =
        application.status === ApplicationStatus.APPROVED
          ? application.program.milestones.find(
              (candidate) =>
                submissionStatuses.get(candidate.id) !==
                SubmissionStatus.APPROVED,
            )
          : undefined;

      if (
        milestone &&
        (!isNonEmptyString(milestone.id) ||
          !isNonEmptyString(milestone.name) ||
          Number.isNaN(milestone.dueAt.getTime()))
      ) {
        continue;
      }

      const nextMilestone: StudentDashboardMilestone | null = milestone
        ? {
            id: milestone.id,
            name: milestone.name,
            dueAt: milestone.dueAt,
            submissionStatus:
              submissionStatuses.get(milestone.id) ?? 'NOT_SUBMITTED',
          }
        : null;
      let repository: StudentDashboardRepository | null = null;
      if (application.status === ApplicationStatus.APPROVED) {
        const projectedRepository = repositoryByApplication.get(application.id);
        if (projectedRepository === undefined) {
          repository = {
            repositoryName: null,
            provisionStatus: 'NOT_STARTED',
            invitationStatus: null,
            githubUrl: null,
          };
        } else {
          const invitationStatus =
            projectedRepository.provisionStatus ===
              RepositoryProvisionJobStatus.SUCCEEDED &&
            projectedRepository.invitationStatus === null &&
            projectedRepository.connectionMode === RepositoryConnectionMode.NEW
              ? RepositoryInvitationStatus.FAILED_FINAL
              : projectedRepository.invitationStatus;
          repository = {
            repositoryName: projectedRepository.repositoryName,
            provisionStatus: projectedRepository.provisionStatus,
            invitationStatus,
            githubUrl: projectedRepository.githubUrl,
          };
        }
      }

      items.push({
        applicationId: application.id,
        programId: application.program.id,
        programName: application.program.name,
        applicationMode,
        displayName,
        applicationStatus: application.status,
        nextMilestone,
        detailUrl: detailUrlFor(application.status, application.program.id),
        checklistUrl: `/programs/${encodeURIComponent(application.program.id)}/submissions`,
        repository,
      });
    }

    return items;
  }
}
