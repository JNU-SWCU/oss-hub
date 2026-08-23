import { Injectable } from '@nestjs/common';
import { ApplicationStatus, SubmissionStatus } from '@prisma/client';
import { DomainException } from '../../common/error-code';
import {
  MILESTONE_NOT_SUBMITTED,
  milestoneCompletionStatus,
} from '../../common/milestone-completion';
import type {
  ApplicationSubmissionSummaryResponseDto,
  ProgramDetailResponseDto,
} from '../dto/program-detail.dto';
import { programDeadline } from '../program-deadline';
import type { ProgramListQuery } from '../program-list-query';
import { PROGRAM_ERROR_CODES } from '../program-error-code';
import {
  getProgramTemplate,
  PROGRAM_PARTICIPATION,
} from '../program-template.registry';
import type { ProgramViewer } from './program-viewer.service';
import {
  ProgramsRepository,
  type ProgramListRecord,
  type ProgramStatusCounts,
} from '../repository/programs.repository';

type SubmissionRecord = {
  readonly milestoneId: string;
  readonly status: SubmissionStatus;
};

type DocumentSubmissionRecord = {
  readonly milestoneDocumentId: string;
  readonly status: SubmissionStatus;
};

/** 한 신청이 이 마일스톤에서 어디까지 왔는가 — 판정은 `milestoneCompletionStatus` 가 한다. */
function milestoneStatusFor(
  milestone: {
    readonly id: string;
    readonly documents: readonly { readonly id: string }[];
  },
  submissions: readonly SubmissionRecord[],
  documentSubmissions: readonly DocumentSubmissionRecord[],
) {
  return milestoneCompletionStatus({
    requiredDocumentStatuses: milestone.documents.map(
      (document) =>
        documentSubmissions.find(
          (submission) => submission.milestoneDocumentId === document.id,
        )?.status ?? null,
    ),
    submissionStatus:
      submissions.find((submission) => submission.milestoneId === milestone.id)
        ?.status ?? null,
  });
}

/** 카드 하단 안내 문구. 값이 없으면 필드 자체를 생략한다(undefined). */
export interface ProgramListItemNote {
  readonly text: string;
  readonly icon?: 'team';
}

export interface PersonalizedProgramListItem extends ProgramListRecord {
  /** 뷰어(학생) 본인의 신청 상태 / 뷰어(교직원)용 집계 안내. */
  readonly note?: ProgramListItemNote;
  /** 뷰어(학생) 본인의 신청 상태. 신청한 적 없으면 생략. */
  readonly viewerApplicationStatus?: ApplicationStatus;
  /** 뷰어(교직원)용 — 전체 지원 건수 집계. */
  readonly applicationCount?: number;
  /** 뷰어(교직원)용 — 승인 대기(SUBMITTED) 건수 집계. */
  readonly pendingApplicationCount?: number;
}

export interface ProgramListPage {
  readonly items: readonly PersonalizedProgramListItem[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;
}

export type { ProgramStatusCounts };

const ANONYMOUS_VIEWER: ProgramViewer = {
  githubId: null,
  userId: null,
  role: null,
};

const STUDENT_APPLICATION_STATUS_NOTE: Readonly<
  Record<ApplicationStatus, string>
> = {
  SUBMITTED: '지원서 제출됨 · 교직원 승인을 기다립니다',
  APPROVED: '축하합니다, 참가가 확정되었습니다',
  REJECTED: '아쉽지만 이번에는 함께하지 못합니다',
};

function isTeamProgram(item: ProgramListRecord): boolean {
  return (
    getProgramTemplate(item.category).participation ===
    PROGRAM_PARTICIPATION.TEAM
  );
}

function noteWithTeamIcon(
  text: string,
  item: ProgramListRecord,
): ProgramListItemNote {
  return isTeamProgram(item) ? { text, icon: 'team' } : { text };
}

const EMPTY_SUMMARY = {
  notSubmitted: 0,
  submitted: 0,
  approved: 0,
  changesRequested: 0,
  rejected: 0,
  total: 0,
} as const satisfies ApplicationSubmissionSummaryResponseDto;

@Injectable()
export class ProgramsService {
  constructor(private readonly repository: ProgramsRepository) {}

  async list(
    query: ProgramListQuery,
    viewer: ProgramViewer = ANONYMOUS_VIEWER,
    now = new Date(),
  ): Promise<ProgramListPage> {
    const [rawItems, totalItems] = await this.repository.listPrograms(
      query,
      now,
    );
    return {
      items: await this.personalize(rawItems, viewer),
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / query.pageSize),
    };
  }

  /**
   * 비인증 요청과 STAFF/ADMIN 이 아닌 뷰어에게는 개인화 필드를 절대 담지 않는다.
   * programId in (...) 배치 조회 한 번으로 N+1 을 피한다.
   */
  private async personalize(
    items: readonly ProgramListRecord[],
    viewer: ProgramViewer,
  ): Promise<readonly PersonalizedProgramListItem[]> {
    if (items.length === 0 || !viewer.userId) return items;

    if (viewer.role === 'STUDENT') {
      const programIds = items.map((item) => item.id);
      const statuses = await this.repository.findViewerApplicationStatuses(
        programIds,
        viewer.userId,
      );
      return items.map((item) => {
        const status = statuses.get(item.id);
        if (!status) return item;
        return {
          ...item,
          viewerApplicationStatus: status,
          note: noteWithTeamIcon(STUDENT_APPLICATION_STATUS_NOTE[status], item),
        };
      });
    }

    if (viewer.role === 'STAFF' || viewer.role === 'ADMIN') {
      const programIds = items.map((item) => item.id);
      const counts =
        await this.repository.countApplicationsByProgram(programIds);
      return items.map((item) => {
        const bucket = counts.get(item.id) ?? { total: 0, pending: 0 };
        const text =
          bucket.pending > 0
            ? `지원 ${bucket.total}건 · 승인 대기 ${bucket.pending}건`
            : `지원 ${bucket.total}건`;
        return {
          ...item,
          applicationCount: bucket.total,
          pendingApplicationCount: bucket.pending,
          note: noteWithTeamIcon(text, item),
        };
      });
    }

    return items;
  }

  async statusCounts(now = new Date()): Promise<ProgramStatusCounts> {
    return this.repository.countProgramsByStatus(now);
  }

  async detail(
    programId: string,
    viewer: ProgramViewer,
    now: Date = new Date(),
  ): Promise<ProgramDetailResponseDto> {
    try {
      const program = await this.repository.findProgramDetail(programId);
      if (!program) throw new DomainException(PROGRAM_ERROR_CODES.NOT_FOUND);
      // ARCHIVED 도 공개 목록(ended)에 포함되므로 상세 읽기는 허용한다.
      // 신청·편집 등 쓰기는 각 쓰기 경로에서 lifecycle 로 거부한다.

      const studentApplication =
        viewer.role === 'STUDENT' && viewer.userId
          ? await this.repository.findStudentApplication(
              programId,
              viewer.userId,
            )
          : null;
      const staffApplications =
        viewer.role === 'STAFF' || viewer.role === 'ADMIN'
          ? await this.repository.findApprovedApplications(programId)
          : null;

      return {
        id: program.id,
        name: program.name,
        organizer: program.organizer,
        category: program.category,
        description: program.description,
        repositoryProvisioningEnabled: program.repositoryProvisioningEnabled,
        applicationPeriod: {
          startsAt: program.applicationStartAt.toISOString(),
          endsAt: program.applicationEndAt.toISOString(),
        },
        operatingPeriod: {
          startsAt: program.startAt.toISOString(),
          endsAt: program.endAt.toISOString(),
        },
        viewer: {
          role: viewer.role,
          applicationStatus: studentApplication?.status ?? null,
        },
        milestones: program.milestones.map((milestone) => {
          const deadline = programDeadline(milestone.dueAt, now);
          return {
            id: milestone.id,
            name: milestone.name,
            startAt: milestone.startAt.toISOString(),
            dueAt: milestone.dueAt.toISOString(),
            dDay: deadline.dDay,
            deadlineLabel: deadline.label,
            description: milestone.instructions,
            submissionType: milestone.submissionType,
            viewerSubmissionStatus: studentApplication
              ? milestoneStatusFor(
                  milestone,
                  studentApplication.submissions,
                  studentApplication.milestoneDocumentSubmissions,
                )
              : null,
            applicationSubmissionSummary: staffApplications
              ? this.summaryForMilestone(milestone, staffApplications)
              : null,
          };
        }),
      };
    } catch (error: unknown) {
      if (error instanceof DomainException) throw error;
      throw new DomainException(PROGRAM_ERROR_CODES.DETAIL_LOAD_FAILED);
    }
  }

  private summaryForMilestone(
    milestone: {
      readonly id: string;
      readonly documents: readonly { readonly id: string }[];
    },
    applications: readonly {
      readonly submissions: readonly SubmissionRecord[];
      readonly milestoneDocumentSubmissions: readonly DocumentSubmissionRecord[];
    }[],
  ): ApplicationSubmissionSummaryResponseDto {
    const summary = { ...EMPTY_SUMMARY, total: applications.length };
    for (const application of applications) {
      const status = milestoneStatusFor(
        milestone,
        application.submissions,
        application.milestoneDocumentSubmissions,
      );
      if (status === MILESTONE_NOT_SUBMITTED) summary.notSubmitted += 1;
      else if (status === SubmissionStatus.SUBMITTED) summary.submitted += 1;
      else if (status === SubmissionStatus.APPROVED) summary.approved += 1;
      else if (status === SubmissionStatus.CHANGES_REQUESTED)
        summary.changesRequested += 1;
      else summary.rejected += 1;
    }
    return summary;
  }
}
