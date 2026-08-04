import { apiClient } from '@/lib/api-client';
import type { ViewerRole } from './types';

/**
 * `GET /programs/:programId/overview` 응답 — 프로그램 상세 화면 팩트 바 전용.
 * viewer* 필드 세 개는 역할별로 한쪽만 채워진다(백엔드
 * ProgramOverviewResponseDto와 같은 계약).
 */
export interface ProgramOverview {
  readonly programId: string;
  readonly name: string;
  readonly category: string;
  readonly lifecycle: string;
  readonly milestoneCount: number;
  readonly boardPostCount: number;
  readonly participantCount: number;
  readonly teamCount: number;
  readonly connectedRepositoryCount: number;
  readonly viewerRole: ViewerRole;
  /** 학생 전용 — "내 제출 N / M 서류"의 N. */
  readonly viewerDocumentsCompleted: number | null;
  /** 학생 전용 — "내 제출 N / M 서류"의 M. */
  readonly viewerDocumentsTotal: number | null;
  /** 교직원 전용 — "제출률"의 분자(분모는 participantCount). */
  readonly fullySubmittedParticipantCount: number | null;
}

export function getProgramOverview(
  programId: string,
): Promise<ProgramOverview> {
  return apiClient<ProgramOverview>(
    `programs/${encodeURIComponent(programId)}/overview`,
  );
}
