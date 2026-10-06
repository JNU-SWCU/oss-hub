import type { ApplicationReviewEventKind } from '@prisma/client';
import type {
  ApplicationReviewHistoryEntry,
  StaffApplicationDetail,
} from '../applications.repository';
import { ApplicationListItemResponseDto } from './application-list-response.dto';

export class ReviewHistoryEntryResponseDto {
  readonly id: string;
  readonly eventKind: ApplicationReviewEventKind;
  readonly revision: number;
  readonly actor: {
    readonly name: string | null;
    readonly nickname: string;
  };
  readonly occurredAt: string;
  readonly rejectionReason: string | null;

  private constructor(entry: ApplicationReviewHistoryEntry) {
    this.id = entry.id;
    this.eventKind = entry.eventKind;
    this.revision = entry.revision;
    this.actor = entry.actor;
    this.occurredAt = entry.occurredAt.toISOString();
    this.rejectionReason = entry.rejectionReason;
  }

  static from(
    entry: ApplicationReviewHistoryEntry,
  ): ReviewHistoryEntryResponseDto {
    return new ReviewHistoryEntryResponseDto(entry);
  }
}

export class ApplicationDetailResponseDto extends ApplicationListItemResponseDto {
  readonly reviewHistory: readonly ReviewHistoryEntryResponseDto[];

  private constructor(detail: StaffApplicationDetail) {
    super(detail.application);
    this.reviewHistory = detail.reviewHistory.map((entry) =>
      ReviewHistoryEntryResponseDto.from(entry),
    );
  }

  static fromDetail(
    detail: StaffApplicationDetail,
  ): ApplicationDetailResponseDto {
    return new ApplicationDetailResponseDto(detail);
  }
}
