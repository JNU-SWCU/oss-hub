import { Inject, Injectable } from '@nestjs/common';
import {
  ApplicationStatus,
  RepositoryConnectionMode,
  RepositoryInvitationStatus,
  RepositoryProvisionJobStatus,
  SubmissionStatus,
} from '@prisma/client';
import {
  MILESTONE_NOT_SUBMITTED,
  milestoneCompletionStatus,
  type MilestoneCompletionStatus,
} from '../../common/milestone-completion';
import { programCoverImageUrl } from '../program-cover';
import {
  type OwnedRepositoryProjectionDto,
  REPOSITORIES_READ_PORT,
  type RepositoriesReadPort,
} from '../../github/repositories-read.port';
import { projectSubmissionCompletionTargets } from '../../submissions/submission-completion-projection';
import {
  StudentDashboardReadRepository,
  type StudentDashboardApplicationRow,
} from '../repository/student-dashboard-read.repository';

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

/**
 * 대시보드 카드 한 장.
 *
 * ⚠ 「개인 신청/팀 신청」 구분(`applicationMode`)과 사람 이름(`displayName`)은 없다.
 * 모든 신청이 팀이고 개인 참여는 1인 팀이므로(D5) 카드가 말할 것은 **지금 그 팀의
 * 이름**뿐이다. 인원수로 개인/팀을 갈라 신청자 이름을 띄우면, 팀을 떠난 사람의 이름이
 * 남거나 1인 팀이 팀으로 보이지 않는다.
 */
export interface StudentDashboardItem {
  readonly coverImageUrl?: string | null;
  readonly applicationId: string;
  readonly programId: string;
  readonly programName: string;
  readonly teamName: string;
  readonly teamUrl: string;
  readonly applicationStatus: 'SUBMITTED' | 'APPROVED' | 'REJECTED';
  readonly nextMilestone: StudentDashboardMilestone | null;
  readonly detailUrl: string;
  readonly checklistUrl: string;
  readonly repository: StudentDashboardRepository | null;
}

/** 카드에 실리는 저장소 발급 상태 뷰. 데이터 접근 계층이 아니다. */
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

/**
 * 카드에서 「우리 팀」으로 들어가는 곳. 프로그램 하나에 팀 하나뿐이므로(D5·
 * `TeamMember @@unique([programId, userId])`) 팀 id 가 아니라 프로그램 id 로 적는다.
 * 팀장이든 아니든 지금 그 팀에 속한 사람 전원이 같은 주소를 받는다.
 */
function teamUrlFor(programId: string): string {
  return `/programs/${encodeURIComponent(programId)}/my-team`;
}

/**
 * 이 신청이 마일스톤마다 어디까지 왔는가. 판정은 `milestoneCompletionStatus` 가 한다.
 *
 * 대시보드가 이 판정을 직접 하지 않는 이유는 프로그램 상세(`programs.service.ts`)·교직원
 * 요약(`submission-dashboard-summary.service.ts`)이 이미 같은 함수를 쓰기 때문이다. 표면마다
 * 「서류도 본다」를 따로 적으면 판정이 갈라지고, 실제로 갈라진 동안 대시보드만 학생에게 다른
 * 말을 했다(#1091).
 */
function milestoneStatusesFor(
  application: StudentDashboardApplicationRow,
): ReadonlyMap<string, MilestoneCompletionStatus> {
  // 원장 한 벌을 두 축(옛 방식 단일 제출 · 새 서류 항목)으로 갈라 놓는다.
  const { submissions, documentSubmissions } =
    projectSubmissionCompletionTargets(
      application.milestoneDocumentSubmissions,
    );
  const legacyStatusByMilestone = new Map(
    submissions.map((submission) => [
      submission.milestoneId,
      submission.status,
    ]),
  );
  const statusByDocument = new Map(
    documentSubmissions.map((submission) => [
      submission.milestoneDocumentId,
      submission.status,
    ]),
  );
  return new Map(
    application.program.milestones.map((milestone) => [
      milestone.id,
      milestoneCompletionStatus({
        submissionAxisInUse: milestone.submissionType !== null,
        requiredDocumentStatuses: milestone.documents.map(
          (document) => statusByDocument.get(document.id) ?? null,
        ),
        submissionStatus: legacyStatusByMilestone.get(milestone.id) ?? null,
      }),
    ]),
  );
}

@Injectable()
export class StudentDashboardService {
  constructor(
    private readonly repository: StudentDashboardReadRepository,
    @Inject(REPOSITORIES_READ_PORT)
    private readonly repositories: RepositoriesReadPort,
  ) {}

  async getStudentDashboard(
    sessionGithubId: bigint,
  ): Promise<readonly StudentDashboardItem[]> {
    const [applications, projectedRepositories] = await Promise.all([
      this.repository.findParticipatingApplications(sessionGithubId),
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
      if (
        !isSafeProgramId(application.program.id) ||
        !isNonEmptyString(application.program.name) ||
        !isNonEmptyString(application.team.name)
      ) {
        continue;
      }

      const nextMilestone = this.nextMilestoneFor(application);
      if (nextMilestone === 'invalid') continue;

      items.push({
        coverImageUrl: programCoverImageUrl(
          application.program.id,
          application.program.cover?.id,
        ),
        applicationId: application.id,
        programId: application.program.id,
        programName: application.program.name,
        teamName: application.team.name,
        teamUrl: teamUrlFor(application.program.id),
        applicationStatus: application.status,
        nextMilestone,
        detailUrl: detailUrlFor(application.status, application.program.id),
        checklistUrl: `/programs/${encodeURIComponent(application.program.id)}/submissions`,
        repository: this.repositoryFor(application, repositoryByApplication),
      });
    }

    return items;
  }

  /**
   * 아직 승인되지 않은 첫 마일스톤. 승인 전 신청은 일정 이야기를 하지 않으므로 null 이다.
   * 값이 온전하지 않은 마일스톤은 `'invalid'` 로 알려 카드 자체를 버리게 한다 — 반쪽짜리
   * 마일스톤을 실어 보내면 frontend 검증기가 대시보드 전체를 오류로 바꾼다.
   */
  private nextMilestoneFor(
    application: StudentDashboardApplicationRow,
  ): StudentDashboardMilestone | null | 'invalid' {
    if (application.status !== ApplicationStatus.APPROVED) return null;

    const milestoneStatuses = milestoneStatusesFor(application);
    const milestone = application.program.milestones.find(
      (candidate) =>
        milestoneStatuses.get(candidate.id) !== SubmissionStatus.APPROVED,
    );
    if (milestone === undefined) return null;
    if (
      !isNonEmptyString(milestone.id) ||
      !isNonEmptyString(milestone.name) ||
      Number.isNaN(milestone.dueAt.getTime())
    ) {
      return 'invalid';
    }

    return {
      id: milestone.id,
      name: milestone.name,
      dueAt: milestone.dueAt,
      submissionStatus:
        milestoneStatuses.get(milestone.id) ?? MILESTONE_NOT_SUBMITTED,
    };
  }

  /**
   * 승인된 신청만 저장소 칸을 갖는다. 발급 기록이 아직 없으면 `NOT_STARTED` 로 자리를
   * 만들어 둔다 — 칸이 통째로 비면 화면이 「발급 실패」와 「아직 시작 전」을 구분하지 못한다.
   */
  private repositoryFor(
    application: StudentDashboardApplicationRow,
    repositoryByApplication: ReadonlyMap<string, OwnedRepositoryProjectionDto>,
  ): StudentDashboardRepository | null {
    if (application.status !== ApplicationStatus.APPROVED) return null;

    const projectedRepository = repositoryByApplication.get(application.id);
    if (projectedRepository === undefined) {
      return {
        repositoryName: null,
        provisionStatus: 'NOT_STARTED',
        invitationStatus: null,
        githubUrl: null,
      };
    }

    // 새로 만든 저장소인데 초대 흔적이 없으면 닫는 쪽으로 읽는다 — 초대가 사라진 성공을
    // 「완료」로 그리면 학생은 들어갈 수 없는 저장소 앞에서 기다린다.
    const invitationStatus =
      projectedRepository.provisionStatus ===
        RepositoryProvisionJobStatus.SUCCEEDED &&
      projectedRepository.invitationStatus === null &&
      projectedRepository.connectionMode === RepositoryConnectionMode.NEW
        ? RepositoryInvitationStatus.FAILED_FINAL
        : projectedRepository.invitationStatus;

    return {
      repositoryName: projectedRepository.repositoryName,
      provisionStatus: projectedRepository.provisionStatus,
      invitationStatus,
      githubUrl: projectedRepository.githubUrl,
    };
  }
}
