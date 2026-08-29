import { Inject, Injectable } from '@nestjs/common';
import { SubmissionStatus } from '@prisma/client';
import {
  MILESTONE_NOT_SUBMITTED,
  milestoneCompletionStatus,
  type MilestoneCompletionStatus,
} from '../common/milestone-completion';
import {
  SubmissionDashboardSummaryRepository,
  type SubmissionDashboardSummaryRepositoryPort,
} from './submission-dashboard-summary.repository';
import type {
  SubmissionDashboardProgramSummary,
  SubmissionDashboardSummaryPort,
} from './submission-dashboard-summary.port';

interface MutableSubmissionDashboardProgramSummary {
  programId: string;
  approvedApplications: number;
  milestones: number;
  total: number;
  notSubmitted: number;
  submitted: number;
  approved: number;
  changesRequested: number;
  rejected: number;
}

class UnexpectedSubmissionStatusError extends Error {
  override readonly name = 'UnexpectedSubmissionStatusError';
}

@Injectable()
export class SubmissionDashboardSummaryService implements SubmissionDashboardSummaryPort {
  constructor(
    @Inject(SubmissionDashboardSummaryRepository)
    private readonly repository: SubmissionDashboardSummaryRepositoryPort,
  ) {}

  async listByProgram(
    programIds: readonly string[],
  ): Promise<readonly SubmissionDashboardProgramSummary[]> {
    const summaries = programIds.map(emptySummary);
    const summaryByProgram = new Map(
      summaries.map((summary) => [summary.programId, summary]),
    );
    const records = await this.repository.listRecords(programIds);
    const applicationProgramById = new Map<string, string>();
    const milestoneProgramById = new Map<string, string>();

    for (const application of records.applications) {
      applicationProgramById.set(application.id, application.programId);
      const summary = summaryByProgram.get(application.programId);
      if (summary) summary.approvedApplications += 1;
    }
    for (const milestone of records.milestones) {
      milestoneProgramById.set(milestone.id, milestone.programId);
    }

    // 코드 축: (신청 × 마일스톤) 칸 → Submission 상태.
    const submissionByCell = new Map<string, SubmissionStatus>();
    for (const submission of records.submissions) {
      if (
        !isConsistentCell(
          applicationProgramById,
          milestoneProgramById,
          submission,
        )
      ) {
        continue;
      }
      // 첫 행이 이긴다 — 스키마의 `@@unique([applicationId, milestoneId])` 상 둘일 수 없지만
      // 예전 코드가 `countedCells` 로 지키던 성질이라 그대로 둔다.
      const cell = cellKey(submission.applicationId, submission.milestoneId);
      if (!submissionByCell.has(cell)) {
        submissionByCell.set(cell, submission.status);
      }
    }

    // 서류 축 명부: 마일스톤 → 필수 서류 id 들.
    const requiredDocumentsByMilestone = new Map<string, string[]>();
    for (const document of records.milestoneDocuments) {
      if (
        milestoneProgramById.get(document.milestoneId) !==
        document.milestoneProgramId
      ) {
        continue;
      }
      const documents = requiredDocumentsByMilestone.get(document.milestoneId);
      if (documents) documents.push(document.id);
      else
        requiredDocumentsByMilestone.set(document.milestoneId, [document.id]);
    }

    // 서류 축 상태: (신청 × 서류항목) 칸 → 판정 상태.
    const documentStatusByCell = new Map<string, SubmissionStatus>();
    for (const submission of records.documentSubmissions) {
      if (
        !isConsistentCell(
          applicationProgramById,
          milestoneProgramById,
          submission,
        )
      ) {
        continue;
      }
      documentStatusByCell.set(
        cellKey(submission.applicationId, submission.milestoneDocumentId),
        submission.status,
      );
    }

    // 제출 축이 0개인 안내용 마일스톤은 제출 현황의 분모에 넣지 않는다.
    // 신규 서류 항목 마일스톤은 submissionType=null이어도 필수 항목이 있으면
    // 계속 집계한다.
    const activeMilestones = records.milestones.filter(
      (milestone) =>
        milestone.submissionType !== null ||
        (requiredDocumentsByMilestone.get(milestone.id)?.length ?? 0) > 0,
    );
    for (const milestone of activeMilestones) {
      const summary = summaryByProgram.get(milestone.programId);
      if (summary) summary.milestones += 1;
    }
    for (const summary of summaries) {
      summary.total = summary.approvedApplications * summary.milestones;
      summary.notSubmitted = summary.total;
    }

    const milestoneIdsByProgram = groupIdsByProgram(activeMilestones);
    const submissionAxisByMilestone = new Map(
      records.milestones.map((milestone) => [
        milestone.id,
        milestone.submissionType !== null,
      ]),
    );
    const applicationIdsByProgram = groupIdsByProgram(records.applications);

    /**
     * 칸마다 판정을 한 번씩 묻는다 — 승인된 신청 × 그 프로그램의 마일스톤 전부.
     *
     * 예전에는 제출 행을 훑으며 `notSubmitted` 를 깎았다. 그러면 제출 행이 있는 칸만 셀 수 있어
     * 서류만 낸 칸이 영원히 미제출로 남았다. 이제 칸을 직접 돌기 때문에 버킷 합이 `total` 과
     * 어긋날 수 없다.
     */
    for (const summary of summaries) {
      summary.notSubmitted = 0;
      const milestoneIds = milestoneIdsByProgram.get(summary.programId) ?? [];
      const applicationIds =
        applicationIdsByProgram.get(summary.programId) ?? [];
      for (const applicationId of applicationIds) {
        for (const milestoneId of milestoneIds) {
          const documentIds =
            requiredDocumentsByMilestone.get(milestoneId) ?? [];
          addCellCount(
            summary,
            milestoneCompletionStatus({
              submissionAxisInUse:
                submissionAxisByMilestone.get(milestoneId) ?? true,
              requiredDocumentStatuses: documentIds.map(
                (documentId) =>
                  documentStatusByCell.get(
                    cellKey(applicationId, documentId),
                  ) ?? null,
              ),
              submissionStatus:
                submissionByCell.get(cellKey(applicationId, milestoneId)) ??
                null,
            }),
          );
        }
      }
    }

    return summaries;
  }
}

function cellKey(applicationId: string, otherId: string): string {
  return `${applicationId}::${otherId}`;
}

function groupIdsByProgram(
  rows: readonly { readonly id: string; readonly programId: string }[],
): ReadonlyMap<string, readonly string[]> {
  const byProgram = new Map<string, string[]>();
  for (const row of rows) {
    const ids = byProgram.get(row.programId);
    if (ids) ids.push(row.id);
    else byProgram.set(row.programId, [row.id]);
  }
  return byProgram;
}

/**
 * 이 행이 정말 한 프로그램 안의 칸인가. 신청·마일스톤이 서로 다른 프로그램을 가리키면 버린다 —
 * 예전 코드가 세 갈래로 대조하던 것과 같은 조건이다.
 */
function isConsistentCell(
  applicationProgramById: ReadonlyMap<string, string>,
  milestoneProgramById: ReadonlyMap<string, string>,
  row: {
    readonly applicationId: string;
    readonly applicationProgramId: string;
    readonly milestoneId: string;
    readonly milestoneProgramId: string;
  },
): boolean {
  return (
    applicationProgramById.get(row.applicationId) ===
      row.applicationProgramId &&
    milestoneProgramById.get(row.milestoneId) === row.milestoneProgramId &&
    row.applicationProgramId === row.milestoneProgramId
  );
}

function emptySummary(
  programId: string,
): MutableSubmissionDashboardProgramSummary {
  return {
    programId,
    approvedApplications: 0,
    milestones: 0,
    total: 0,
    notSubmitted: 0,
    submitted: 0,
    approved: 0,
    changesRequested: 0,
    rejected: 0,
  };
}

function addCellCount(
  summary: MutableSubmissionDashboardProgramSummary,
  status: MilestoneCompletionStatus,
): void {
  switch (status) {
    case MILESTONE_NOT_SUBMITTED:
      summary.notSubmitted += 1;
      return;
    case SubmissionStatus.SUBMITTED:
      summary.submitted += 1;
      return;
    case SubmissionStatus.APPROVED:
      summary.approved += 1;
      return;
    case SubmissionStatus.CHANGES_REQUESTED:
      summary.changesRequested += 1;
      return;
    case SubmissionStatus.REJECTED:
      summary.rejected += 1;
      return;
  }
  const unreachable: never = status;
  throw new UnexpectedSubmissionStatusError(unreachable);
}
