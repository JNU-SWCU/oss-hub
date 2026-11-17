import type { TeamHistoryEvent, ApplicationStatus } from '@prisma/client';
import type {
  ApplicationReviewHistoryEntry,
  StaffApplicationDetail,
} from '../team.repository';

export class ReviewHistoryEntryResponseDto {
  declare readonly id: string;
  declare readonly eventKind: TeamHistoryEvent;
  declare readonly revision: number | null;
  declare readonly actor: {
    readonly name: string | null;
    readonly nickname: string;
  };
  declare readonly occurredAt: string;
  declare readonly rejectionReason: string | null;

  static from(
    entry: ApplicationReviewHistoryEntry,
  ): ReviewHistoryEntryResponseDto {
    return {
      id: entry.id,
      eventKind: entry.eventKind,
      revision: entry.revision,
      actor: entry.actor,
      occurredAt: entry.occurredAt.toISOString(),
      rejectionReason: entry.rejectionReason,
    };
  }
}

export class ApplicationDetailResponseDto {
  declare readonly status: ApplicationStatus;
  declare readonly rejectionReason: string | null;
  declare readonly applicant: {
    readonly name: string | null;
    readonly nickname: string;
  };
  declare readonly reviewHistory: ReviewHistoryEntryResponseDto[];

  static from(detail: StaffApplicationDetail): ApplicationDetailResponseDto {
    const { application } = detail;
    return {
      status: application.status,
      rejectionReason: application.rejectionReason,
      applicant: {
        name: application.applicant.name,
        nickname: application.applicant.nickname,
      },
      reviewHistory: detail.reviewHistory.map((entry) =>
        ReviewHistoryEntryResponseDto.from(entry),
      ),
    };
  }
}
