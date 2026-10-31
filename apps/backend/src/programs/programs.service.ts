import { Injectable } from '@nestjs/common';
import {
  ApplicationStatus,
  type MilestoneSubmissionType,
  SubmissionStatus,
  type ProgramTrackType,
  type ProgramLifecycle,
} from '@prisma/client';
import { DomainException } from '../platform/error-code.error';
import { PROGRAM_READ_ERROR_CODES } from './program-read-error-code.error';
import {
  type ProgramViewer,
  ProgramViewerRole,
} from './program-viewer.service';
import {
  ProgramsRepository,
  ProgramListRecord,
  type ProgramStatusCounts,
} from './programs.repository';
import { MILESTONE_NOT_SUBMITTED } from './milestone-completion.config';
import type { ProgramListQuery } from './program-list-status-filter.repository';
import type { SubmissionCompletionTargetRow } from './submission-completion.config';
import { MilestoneCompletionService } from './milestone-completion.service';
import { ProgramCoverUrlService } from './program-cover-url.service';
import {
  ProgramRulesService,
  PROGRAM_PARTICIPATION,
} from './program-rules.service';

export interface ProgramListItemNote {
  readonly text: string;
  readonly icon?: 'team';
}

export interface ProgramListPageItem extends PersonalizedProgramListItem {
  readonly coverImageUrl: string | null;
}

export interface PersonalizedProgramListItem extends ProgramListRecord {
  readonly note?: ProgramListItemNote;

  readonly viewerApplicationStatus?: ApplicationStatus;

  readonly applicationCount?: number;

  readonly pendingApplicationCount?: number;
}

export interface ProgramListPage {
  readonly items: readonly ProgramListPageItem[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;
}

type ViewerSubmissionStatusResult = SubmissionStatus | 'NOT_SUBMITTED' | null;

export interface ApplicationSubmissionSummaryResult {
  readonly notSubmitted: number;
  readonly submitted: number;
  readonly approved: number;
  readonly changesRequested: number;
  readonly rejected: number;
  readonly total: number;
}

interface ProgramMilestoneResult {
  readonly id: string;
  readonly name: string;
  readonly startAt: Date;
  readonly dueAt: Date;
  readonly dDay: number;
  readonly deadlineLabel: string;
  readonly description: string | null;
  readonly submissionType: MilestoneSubmissionType | null;

  readonly submissionItemCount: number;
  readonly viewerSubmissionStatus: ViewerSubmissionStatusResult;
  readonly applicationSubmissionSummary: ApplicationSubmissionSummaryResult | null;
}

export interface ProgramDetailResult {
  readonly coverImageUrl: string | null;
  readonly id: string;
  readonly name: string;
  readonly organizer: string;
  readonly trackType: ProgramTrackType | null;
  readonly applicationTemplateKey: string;

  readonly lifecycle: ProgramLifecycle;
  readonly description: string;
  readonly repositoryProvisioningEnabled: boolean;
  readonly applicationPeriod: {
    readonly startsAt: Date;
    readonly endsAt: Date;
  };
  readonly operatingPeriod: {
    readonly startsAt: Date;
    readonly endsAt: Date;
  };
  readonly viewer: {
    readonly role: ProgramViewerRole;
    readonly applicationStatus: ApplicationStatus | null;
  };
  readonly milestones: readonly ProgramMilestoneResult[];
}

type SubmissionRecord = {
  readonly milestoneId: string;
  readonly status: SubmissionStatus;
};

type DocumentSubmissionRecord = {
  readonly milestoneDocumentId: string;
  readonly status: SubmissionStatus;
};

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

const EMPTY_SUMMARY = {
  notSubmitted: 0,
  submitted: 0,
  approved: 0,
  changesRequested: 0,
  rejected: 0,
  total: 0,
} as const satisfies ApplicationSubmissionSummaryResult;

@Injectable()
export class ProgramsService {
  constructor(
    private readonly repository: ProgramsRepository,
    private readonly milestoneCompletionService: MilestoneCompletionService,
    private readonly programCoverUrlService: ProgramCoverUrlService,
    private readonly programRulesService: ProgramRulesService,
  ) {}

  private async findStudentApplicationAxes(programId: string, userId: string) {
    const application = await this.repository.findStudentApplication(
      programId,
      userId,
    );
    return application && this.toTargetSubmissionAxes(application);
  }

  private toTargetSubmissionAxes<
    T extends {
      readonly milestoneDocumentSubmissions: readonly SubmissionCompletionTargetRow[];
    },
  >(application: T) {
    const { submissions, documentSubmissions } =
      this.milestoneCompletionService.projectSubmissionCompletionTargets(
        application.milestoneDocumentSubmissions,
      );
    return {
      ...application,
      submissions,
      milestoneDocumentSubmissions: documentSubmissions,
    };
  }

  listQueryFromRequest(request: ProgramListQuery): ProgramListQuery {
    return {
      page: request.page,
      pageSize: request.pageSize,
      search: request.search.trim(),
      status: request.status,
      year: request.year,
      sort: request.sort,
      direction: request.direction,
    };
  }

  listFromRequest(
    request: ProgramListQuery,
    viewer: ProgramViewer,
  ): Promise<ProgramListPage> {
    return this.list(this.listQueryFromRequest(request), viewer);
  }

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
      items: (await this.personalize(rawItems, viewer)).map((item) => ({
        ...item,
        coverImageUrl: this.programCoverUrlService.programCoverImageUrl(
          item.id,
          item.coverId,
          item.coverExternalImageUrl,
        ),
      })),
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / query.pageSize),
    };
  }

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
          note: this.noteWithTeamIcon(
            STUDENT_APPLICATION_STATUS_NOTE[status],
            item,
          ),
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
          note: this.noteWithTeamIcon(text, item),
        };
      });
    }

    return items;
  }

  async statusCounts(now = new Date()): Promise<ProgramStatusCounts> {
    return this.repository.countProgramsByStatus(now);
  }

  async endedYears(now = new Date()): Promise<readonly number[]> {
    return this.repository.findEndedYears(now);
  }

  async detail(
    programId: string,
    viewer: ProgramViewer,
    now: Date = new Date(),
  ): Promise<ProgramDetailResult> {
    try {
      const program = await this.repository.findProgramDetail(programId);
      if (!program)
        throw new DomainException(PROGRAM_READ_ERROR_CODES.NOT_FOUND);

      const studentApplication =
        viewer.role === 'STUDENT' && viewer.userId
          ? await this.findStudentApplicationAxes(programId, viewer.userId)
          : null;
      const staffApplications =
        viewer.role === 'STAFF' || viewer.role === 'ADMIN'
          ? (await this.repository.findApprovedApplications(programId)).map(
              (application) => this.toTargetSubmissionAxes(application),
            )
          : null;

      return {
        id: program.id,
        coverImageUrl: this.programCoverUrlService.programCoverImageUrl(
          program.id,
          program.cover?.id,
          program.cover?.imageUrl,
        ),
        name: program.name,
        organizer: program.organizer,
        trackType: program.trackType,
        applicationTemplateKey: program.applicationTemplateKey,
        lifecycle: program.lifecycle,
        description: program.description,
        repositoryProvisioningEnabled: program.repositoryProvisioningEnabled,
        applicationPeriod: {
          startsAt: program.applicationStartAt,
          endsAt: program.applicationEndAt,
        },
        operatingPeriod: {
          startsAt: program.startAt,
          endsAt: program.endAt,
        },
        viewer: {
          role: viewer.role,
          applicationStatus: studentApplication?.status ?? null,
        },
        milestones: program.milestones.map((milestone) => {
          const deadline = this.programRulesService.programDeadline(
            milestone.dueAt,
            now,
          );
          return {
            id: milestone.id,
            name: milestone.name,
            startAt: milestone.startAt,
            dueAt: milestone.dueAt,
            dDay: deadline.dDay,
            deadlineLabel: deadline.label,
            description: milestone.instructions,
            submissionType: milestone.submissionType,
            submissionItemCount: milestone._count.documents,
            viewerSubmissionStatus:
              milestone.submissionType !== null && studentApplication
                ? this.milestoneStatusFor(
                    milestone,
                    studentApplication.submissions,
                    studentApplication.milestoneDocumentSubmissions,
                  )
                : null,
            applicationSubmissionSummary:
              milestone.submissionType !== null && staffApplications
                ? this.summaryForMilestone(milestone, staffApplications)
                : null,
          };
        }),
      };
    } catch (error: unknown) {
      if (error instanceof DomainException) throw error;
      throw new DomainException(PROGRAM_READ_ERROR_CODES.DETAIL_LOAD_FAILED);
    }
  }

  private summaryForMilestone(
    milestone: {
      readonly id: string;
      readonly submissionType: MilestoneSubmissionType | null;
      readonly documents: readonly { readonly id: string }[];
    },
    applications: readonly {
      readonly submissions: readonly SubmissionRecord[];
      readonly milestoneDocumentSubmissions: readonly DocumentSubmissionRecord[];
    }[],
  ): ApplicationSubmissionSummaryResult {
    const summary = { ...EMPTY_SUMMARY, total: applications.length };
    for (const application of applications) {
      const status = this.milestoneStatusFor(
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

  private milestoneStatusFor(
    milestone: {
      readonly id: string;
      readonly submissionType: MilestoneSubmissionType | null;
      readonly documents: readonly { readonly id: string }[];
    },
    submissions: readonly SubmissionRecord[],
    documentSubmissions: readonly DocumentSubmissionRecord[],
  ) {
    return this.milestoneCompletionService.milestoneCompletionStatus({
      submissionAxisInUse: milestone.submissionType !== null,
      requiredDocumentStatuses: milestone.documents.map(
        (document) =>
          documentSubmissions.find(
            (submission) => submission.milestoneDocumentId === document.id,
          )?.status ?? null,
      ),
      submissionStatus:
        submissions.find(
          (submission) => submission.milestoneId === milestone.id,
        )?.status ?? null,
    });
  }

  private isTeamProgram(item: ProgramListRecord): boolean {
    const template = this.programRulesService.getTemplateByKey(
      item.applicationTemplateKey,
    );
    return template?.participation === PROGRAM_PARTICIPATION.TEAM;
  }

  private noteWithTeamIcon(
    text: string,
    item: ProgramListRecord,
  ): ProgramListItemNote {
    return this.isTeamProgram(item) ? { text, icon: 'team' } : { text };
  }
}
