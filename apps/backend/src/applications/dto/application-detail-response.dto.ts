import type { ApplicationReviewEventKind } from '@prisma/client';
import type {
  ApplicationReviewHistoryEntry,
  StaffApplicationDetail,
} from '../applications.repository';
import { ApplicationListItemResponseDto } from './application-list-response.dto';

/**
 * 검토 이력 한 줄. allowlist만 싣는다 — 표시 가능한 actor 이름·계정까지고 학번·소속·연락처는
 * projection이 애초에 읽지 않는다.
 *
 * `rejectionReason`은 반려 사건에만 값이 있다. 그 불변식은 append writer가
 * (`review-history.writer.ts`) 쓰기 경계에서 강제하므로 여기서 다시 걸러 내지 않는다 —
 * 두 곳이 같은 규칙을 각자 적으면 한쪽만 바뀌었을 때 어느 쪽이 정본인지 알 수 없다.
 */
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

  static from(entry: ApplicationReviewHistoryEntry): ReviewHistoryEntryResponseDto {
    return new ReviewHistoryEntryResponseDto(entry);
  }
}

/**
 * 교직원 신청 상세. 기존 목록 항목 모양을 그대로 이어받고 `reviewHistory`만 **더한다** —
 * 이미 배포된 프런트는 새 키를 무시하므로 중간 배포 구간에서 깨지지 않는다.
 *
 * 목록 응답에는 이 키가 없다. 목록은 신청마다 이력을 끌고 오면 N+1이 되고, 화면도 목록에서
 * 타임라인을 그리지 않는다.
 */
export class ApplicationDetailResponseDto extends ApplicationListItemResponseDto {
  /** 최신순. 팀 상세의 타임라인이 이 순서를 그대로 렌더한다(AC-18). */
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
