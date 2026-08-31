/**
 * 「이 마일스톤이 이 신청에 대해 끝났는가」를 축과 무관하게 답하는 **단 하나의 자리**.
 *
 * 마일스톤에는 제출 축이 둘 있다.
 *
 * - **코드 축** — `Submission` 한 행(`Milestone.submissionType` 이 FILE/TEXT 를 정한다).
 * - **서류 축** — `MilestoneDocument` 여러 항목과 (항목 × 신청)당 `MilestoneDocumentSubmission`.
 *
 * 전환 기간에는 nullable `Milestone.submissionType`이 축의 **설정 여부**를 알려 준다.
 * 다만 기존 #820 서류-only 마일스톤은 스키마가 NOT NULL이던 때 만들어져
 * `submissionType` 은 있지만 `Submission` 행은 없다. 따라서 필수 서류가 있는 칸은
 * 실제 `Submission` 행이 있을 때만 레거시 축을 함께 쓰고, 필수 서류가 없는 칸은
 * nullable 설정값으로 안내용(0축)과 레거시 단일 제출을 구분한다.
 *
 * 이 모듈이 `common/` 에 있는 이유는 `milestone-document-locks.ts` 와 같다 — 세 표면
 * (저장소 공개 자격 · 교직원 대시보드 요약 · 프로그램 상세)이 **같은 판정**을 써야 하는데
 * 어느 한 모듈이 소유하면 형제 모듈이 계약 없이 남의 업무 규칙을 복제하게 된다(ADR-003).
 * 표면마다 「서류도 본다」를 덧붙이면 다음 변경에서 판정이 세 벌로 갈라진다 — #752 에서 공개
 * 게이트를 한 함수로 모은 것과 같은 이유다.
 */
import { MilestoneSubmissionType, SubmissionStatus } from '@prisma/client';

/** 칸 하나(신청 × 마일스톤)의 상태. 제출 행이 하나도 없는 상태를 `NOT_SUBMITTED` 로 표현하는 것은 기존 DTO 관례를 따른 것이다. */
export type MilestoneCompletionStatus = SubmissionStatus | 'NOT_SUBMITTED';

export const MILESTONE_NOT_SUBMITTED = 'NOT_SUBMITTED' as const;

/**
 * 한 마일스톤 × 한 신청의 두 축 재료.
 *
 * 두 필드 모두 **호출자가 이미 이 신청으로 좁혀서** 넘긴다 — 이 함수는 신청 id 를 모른다.
 */
export interface MilestoneCompletionInput {
  /**
   * 상위 단일 제출 축이 설정된 레거시 마일스톤이면 true.
   *
   * 옮은 호출자가 이 값을 넘기지 않아도 기존 판정을 유지하도록 true로 간주한다.
   * 신규 마일스톤(`submissionType = null`)을 다루는 호출자는 반드시 false를 넘긴다.
   */
  readonly submissionAxisInUse?: boolean;
  /**
   * 이 마일스톤의 **필수**(`required: true`) 서류 항목마다 한 칸씩. 제출 행이 없으면 `null`.
   *
   * ⚠ 선택 서류(`required: false`)는 여기 넣지 않는다 — 안 낸 선택 서류가 마일스톤을 영원히
   * 미완료로 잡아 두면 「필수」라는 구분이 뜻을 잃는다.
   *
   * 필수 항목이 하나도 없으면 빈 배열이고, 그때 서류 축은 **쓰이지 않은 것으로** 본다.
   */
  readonly requiredDocumentStatuses: readonly (SubmissionStatus | null)[];
  /** 이 신청의 `Submission` 상태. 행이 없으면 `null`. */
  readonly submissionStatus: SubmissionStatus | null;
}

/**
 * 나쁜 쪽이 이긴다 — 한 축이라도 이 상태면 칸 전체가 이 상태다. 앞쪽이 강하다.
 *
 * `APPROVED` 가 맨 뒤인 것이 이 표의 요점이다: **모든** 칸이 승인일 때만 칸이 승인으로 남는다.
 */
const STATUS_PRECEDENCE: readonly MilestoneCompletionStatus[] = [
  SubmissionStatus.REJECTED,
  SubmissionStatus.CHANGES_REQUESTED,
  MILESTONE_NOT_SUBMITTED,
  SubmissionStatus.SUBMITTED,
  SubmissionStatus.APPROVED,
];

/**
 * 신규 마일스톤은 `submissionType = null`이므로 상위 단일 제출 축을 쓰지 않는다.
 * 레거시 서류-only 마일스톤은 `submissionType` 이 남아 있어도 필수 서류가 있고
 * `Submission` 행이 없으면 상위 축을 쓰지 않았던 것으로 본다.
 */
function isSubmissionAxisInUse(input: MilestoneCompletionInput): boolean {
  if (input.submissionAxisInUse === false) return false;
  return (
    input.requiredDocumentStatuses.length === 0 ||
    input.submissionStatus !== null
  );
}

/** 쓰이고 있는 축들의 칸 상태를 모두 모은다. 최소 한 칸은 반드시 들어간다. */
function collectAxisStatuses(
  input: MilestoneCompletionInput,
): readonly MilestoneCompletionStatus[] {
  const statuses: MilestoneCompletionStatus[] =
    input.requiredDocumentStatuses.map(
      (status) => status ?? MILESTONE_NOT_SUBMITTED,
    );
  if (isSubmissionAxisInUse(input)) {
    statuses.push(input.submissionStatus ?? MILESTONE_NOT_SUBMITTED);
  }
  return statuses;
}

/**
 * 칸 하나의 상태. 교직원 대시보드 요약·프로그램 상세가 이것으로 버킷을 센다.
 *
 * 쓰이는 축이 여럿이면 `STATUS_PRECEDENCE` 로 가장 나쁜 상태가 이긴다.
 */
export function milestoneCompletionStatus(
  input: MilestoneCompletionInput,
): MilestoneCompletionStatus {
  const statuses = collectAxisStatuses(input);
  if (statuses.length === 0) return MILESTONE_NOT_SUBMITTED;
  let worst: MilestoneCompletionStatus = SubmissionStatus.APPROVED;
  let worstRank = STATUS_PRECEDENCE.indexOf(worst);
  for (const status of statuses) {
    const rank = STATUS_PRECEDENCE.indexOf(status);
    if (rank < worstRank) {
      worst = status;
      worstRank = rank;
    }
  }
  return worst;
}

/**
 * 이 마일스톤이 이 신청에 대해 끝났는가. 저장소 공개 자격이 이것을 마일스톤마다 묻는다.
 *
 * ⚠ 저장소 공개는 민감하다 — 이 함수가 참을 더 자주 돌려주면 공개하면 안 될 저장소가 공개된다.
 * `milestone-completion.spec.ts` 가 「승인 하나를 빼면 거짓이 된다」를 축마다 못 박고 있다.
 */
export function isMilestoneComplete(input: MilestoneCompletionInput): boolean {
  return milestoneCompletionStatus(input) === SubmissionStatus.APPROVED;
}

/**
 * 프로그램의 공개에 필요한 마일스톤이 한 신청에 대해 모두 완료됐는지 같은 축 판정으로 집계한다.
 *
 * 상위 제출 축도 필수 서류 축도 없는 안내용 마일스톤은 완료할 것이 없으므로 집계에서 뺀다.
 * 다만 표시 상태는 여전히 `NOT_SUBMITTED`다. 공개 집계의 공집합 완료와 화면의 fail-closed
 * 상태 표시는 서로 다른 계약이다.
 */
export function requiredMilestonesApproved(
  milestones: readonly {
    readonly id: string;
    /** 기존 내부 호출은 생략값을 레거시 축으로 본다. 신규 호출은 null을 명시한다. */
    readonly submissionType?: MilestoneSubmissionType | null;
    readonly documents: readonly { readonly id: string }[];
  }[],
  submissions: readonly {
    readonly milestoneId: string;
    readonly status: SubmissionStatus;
  }[],
  documentSubmissions: readonly {
    readonly milestoneDocumentId: string;
    readonly status: SubmissionStatus;
  }[],
): boolean {
  const statusByMilestone = new Map(
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
  return milestones.every((milestone) =>
    milestone.submissionType === null && milestone.documents.length === 0
      ? true
      : isMilestoneComplete({
          ...(milestone.submissionType === null
            ? { submissionAxisInUse: false }
            : {}),
          requiredDocumentStatuses: milestone.documents.map(
            (document) => statusByDocument.get(document.id) ?? null,
          ),
          submissionStatus: statusByMilestone.get(milestone.id) ?? null,
        }),
  );
}
