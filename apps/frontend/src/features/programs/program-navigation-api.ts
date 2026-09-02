import { apiClient } from '@/lib/api-client';

interface PublicProgramNavigationResponse {
  readonly milestones: readonly {
    readonly id: string;
    readonly name: string;
    readonly submissionType: 'FILE' | 'TEXT' | null;
    readonly submissionItemCount: number;
  }[];
}

export interface ProgramNavigationMilestone {
  readonly milestoneId: string;
  readonly title: string;
  /** 학생의 레거시 체크리스트에서 선택할 수 있는 단계인지 여부. */
  readonly submissionEnabled: boolean;
}

/**
 * 역할별 제출 통계를 섞지 않은 공개 프로그램 상세에서 전체 단계 탐색 목록을 읽는다.
 * overview의 milestoneDocuments는 서류 항목이 0개인 단계를 의도적으로 생략하므로
 * 화면 크기에 따라 단계 목록이 달라지지 않게 탐색 목록과 통계 목록을 분리한다.
 */
export async function getProgramNavigationMilestones(
  programId: string,
): Promise<readonly ProgramNavigationMilestone[]> {
  const program = await apiClient<PublicProgramNavigationResponse>(
    `programs/${encodeURIComponent(programId)}`,
  );
  return program.milestones.map((milestone) => ({
    milestoneId: milestone.id,
    title: milestone.name,
    submissionEnabled: milestone.submissionType !== null,
  }));
}
