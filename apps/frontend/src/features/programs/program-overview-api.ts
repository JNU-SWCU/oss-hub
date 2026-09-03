import { apiClient } from '@/lib/api-client';
import type { ViewerRole } from './types';

/**
 * 서류가 있는 마일스톤 요약 — 프로그램 스코프 좌측 패널의 depth-1 자식을 채운다.
 * 분자·분모의 의미는 뷰어 역할로 갈린다(학생은 내 서류 수, 교직원은 완주 팀 수).
 * 백엔드 `MilestoneDocumentSummaryResponseDto`와 같은 계약이다.
 */
export interface ProgramOverviewMilestoneDocument {
  readonly milestoneId: string;
  readonly title: string;
  readonly completed: number;
  readonly total: number;
}

/**
 * `GET /programs/:programId/overview` 응답 — 프로그램 상세 화면 팩트 바 전용.
 * viewer* 필드 세 개는 역할별로 한쪽만 채워진다(백엔드
 * ProgramOverviewResponseDto와 같은 계약).
 */
export interface ProgramOverview {
  readonly programId: string;
  readonly name: string;
  readonly trackType: string | null;
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
  /** 남은 마감 마일스톤 — 전부 지났으면 빈 배열. 좌측 패널 카운트다운의 입력이다. */
  readonly remainingMilestones: readonly {
    readonly label: string;
    readonly dueAt: string;
  }[];
  /** 서류가 있는 마일스톤만, 순서대로. 좌측 패널 depth-1 자식의 입력이다. */
  readonly milestoneDocuments: readonly ProgramOverviewMilestoneDocument[];
}

class ProgramOverviewResponseError extends Error {
  constructor() {
    super('프로그램 개요 응답 형식이 올바르지 않습니다.');
    this.name = 'ProgramOverviewResponseError';
  }
}

export function parseProgramOverview(value: unknown): ProgramOverview {
  if (typeof value !== 'object' || value === null) {
    throw new ProgramOverviewResponseError();
  }
  const record = value as Record<string, unknown>;
  if ('category' in record) {
    throw new ProgramOverviewResponseError();
  }
  return record as unknown as ProgramOverview;
}

export async function getProgramOverview(
  programId: string,
): Promise<ProgramOverview> {
  return parseProgramOverview(
    await apiClient<unknown>(
      `programs/${encodeURIComponent(programId)}/overview`,
    ),
  );
}
