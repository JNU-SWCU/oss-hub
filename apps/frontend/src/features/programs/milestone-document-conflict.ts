import { ApiError } from '@/lib/api-client';
import { MILESTONE_DOCUMENT_REVIEW_ERROR_CODES } from './milestone-document-review-api';

/**
 * 서류 화면의 **충돌(409·404) 뒤처리** 전담부 — 무엇을 다시 부를 일로 볼 것인가, 그리고
 * 그 다시 부르기가 끝난 뒤 사람에게 무엇을 말할 것인가.
 *
 * 교직원 수합 표(`milestone-document-collection-screen.tsx`)와 학생 목록
 * (`milestone-document-list.tsx`)이 **같은 사건의 양쪽**이라 한자리에 둔다: 교직원이 판정을
 * 저장하는 순간 학생이 다시 내면 한쪽은 409(MSD_025)를, 반대 순서면 다른 쪽이
 * 409(MSD_024)를 받는다. 두 문구를 떨어뜨려 두면 어느 날 같은 말이 두 화면에 붙어
 * 「무엇이 바뀌었는지」가 사라진다.
 *
 * ⚠ 이 파일의 문구는 **다시 부르기가 끝난 뒤**에 쓰는 말이다. 부르기 전에 미리 띄우면
 * 「다시 불러왔습니다」라고 적어 놓고 아직 안 불러온 화면이 남는다 — 조회가 느리거나
 * 실패하면 그 문구 아래에 옛 표가 그대로 살아서 조작까지 된다.
 */

/** 다시 부르기가 어떻게 끝났는가. */
export type MilestoneDocumentReloadResult = 'reloaded' | 'failed';

/**
 * 수합 표의 재조회 결과. 갈래가 하나 더 있는 것은 표가 **경합 방지**를 걸어 두기
 * 때문이다 — 그 사이 필터·페이지가 바뀌었거나 다른 조회가 시작되면 늦게 온 응답은
 * 버려진다(`superseded`). 그때 화면을 쥔 것은 남의 조회라, 이쪽이 표를 걷거나 문구를
 * 띄우면 남의 조회 결과에 엉뚱한 말이 붙는다.
 */
export type MilestoneDocumentCollectionReloadResult =
  MilestoneDocumentReloadResult | 'superseded';

/**
 * 판정을 저장하지 못한 이유 중 **손에 든 표가 낡았다**는 뜻인 것들. 셋을 하나로 뭉치지
 * 않는 것은 실패 문구의 첫 문장이 서로 다르기 때문이다 — 「다른 판정이 먼저 등록됐다」와
 * 「제출물 자체가 바뀌었다」와 「제출이 사라졌다」는 교직원이 다음에 할 일이 다르다.
 */
export type MilestoneDocumentReviewConflict =
  'review-changed' | 'target-changed' | 'submission-missing';

function hasProblemCode(error: unknown, code: string): boolean {
  return error instanceof ApiError && error.problem.code === code;
}

/**
 * 판정 저장 실패가 「표가 낡았다」인가 — 맞으면 어떤 낡음인지, 아니면 `null`.
 *
 * 사유 필수(422)처럼 **입력**이 문제인 실패는 여기서 걸리지 않는다. 그것은 표가 아니라
 * 교직원이 고칠 수 있는 일이라, 표를 다시 부르면 적어 둔 자리만 흔들린다.
 */
export function milestoneDocumentReviewConflictOf(
  error: unknown,
): MilestoneDocumentReviewConflict | null {
  if (
    hasProblemCode(
      error,
      MILESTONE_DOCUMENT_REVIEW_ERROR_CODES.REVIEW_TARGET_CHANGED,
    )
  ) {
    return 'target-changed';
  }
  if (
    hasProblemCode(error, MILESTONE_DOCUMENT_REVIEW_ERROR_CODES.REVIEW_CHANGED)
  ) {
    return 'review-changed';
  }
  if (
    hasProblemCode(
      error,
      MILESTONE_DOCUMENT_REVIEW_ERROR_CODES.SUBMISSION_NOT_FOUND,
    )
  ) {
    return 'submission-missing';
  }
  return null;
}

/**
 * 「내가 본 그 제출물이 아니다」(409 MSD_025)인가 — 다른 충돌과 **다루는 방식이 다르다.**
 *
 * 이건 입력이 틀린 것도, 잠깐의 장애도 아니다. 판정의 근거가 이미 사라졌다는 뜻이라
 * 같은 판정을 다시 눌러 통과시켜서는 안 된다. 그래서 패널에 문구만 남기지 않고 적어 둔
 * 판정을 통째로 버린다.
 */
export function isMilestoneDocumentReviewTargetChanged(
  conflict: MilestoneDocumentReviewConflict,
): boolean {
  return conflict === 'target-changed';
}

/** 판정이 저장되지 않았다는 사실 — 충돌마다 「무엇이 바뀌었는가」가 다르다. */
const REVIEW_CONFLICT_LEAD: Readonly<
  Record<MilestoneDocumentReviewConflict, string>
> = {
  'target-changed':
    '검토하는 사이에 이 서류의 제출물 또는 검토 결과가 바뀌어, 방금 고른 결과는 저장하지 않았습니다.',
  'review-changed':
    '검토하는 사이에 다른 검토 결과가 먼저 등록되어, 방금 고른 결과는 저장하지 않았습니다.',
  'submission-missing':
    '검토하려던 제출을 찾지 못해, 방금 고른 결과는 저장하지 않았습니다.',
};

/**
 * 표를 다시 부른 결과. **부른 뒤에** 붙이는 말이라 둘 다 사실이다.
 *
 * 실패 쪽이 「표를 걷었다」고 말하는 것은 화면이 실제로 그렇게 하기 때문이다 — 서버가
 * 「그 표는 낡았다」고 말한 뒤이므로, 못 불러온 낡은 표를 그대로 두면 교직원은 이미
 * 지나간 칸을 계속 조작하고 누를 때마다 같은 409를 받는다.
 */
const REVIEW_CONFLICT_RELOAD_TAIL: Readonly<
  Record<MilestoneDocumentReloadResult, string>
> = {
  reloaded:
    '표를 최신 내용으로 다시 불러왔습니다 — 제출 내용을 다시 확인한 뒤 다시 검토해 주세요.',
  failed:
    '표를 다시 불러오지 못했습니다 — 낡은 내용을 그대로 두지 않으려고 표를 걷었습니다. 「다시 시도」로 불러온 뒤 다시 검토해 주세요.',
};

/**
 * 충돌과 재조회 결과를 알리는 표 쪽 문구. 띄울 말이 없으면 `null`.
 *
 * `null`이 되는 두 자리:
 * - `superseded` — 화면은 이미 남의 조회로 넘어갔다. 그 표에 대고 앞 판정 이야기를 하면
 *   지금 보고 있는 표의 말로 읽힌다.
 * - 「제출물이 바뀜」이 아닌 충돌 + 재조회 성공 — 그때는 판정 패널이 열린 채로 남아 서버
 *   문구를 이미 보여 주고 있다. 같은 말을 표 위에 한 번 더 띄우면 두 번 실패한 것처럼 읽힌다.
 */
export function milestoneDocumentReviewConflictNotice(
  conflict: MilestoneDocumentReviewConflict,
  result: MilestoneDocumentCollectionReloadResult,
): string | null {
  if (result === 'superseded') return null;
  if (
    result === 'reloaded' &&
    !isMilestoneDocumentReviewTargetChanged(conflict)
  )
    return null;
  return `${REVIEW_CONFLICT_LEAD[conflict]} ${REVIEW_CONFLICT_RELOAD_TAIL[result]}`;
}

/**
 * 학생이 내는 사이에 교직원 판정이 먼저 커밋됐는가(409 MSD_024).
 *
 * 이 하나만 다시 부르는 대상이다. 화면이 아는 상태가 **이미 낡았다**는 뜻이라, 문구만
 * 띄우고 두면 화면은 여전히 「보완 요청」으로 알아 제출 입력을 열어 둔다 — 그 판정이
 * 승인이나 반려였다면 학생은 이미 금지된 조작을 계속 보고, 누를 때마다 409를 다시 받는다.
 * 마감·권한처럼 상태가 낡아서 나는 것이 아닌 실패는 문구만 보여 주면 된다.
 */
export function isMilestoneDocumentSubmitReviewChanged(
  error: unknown,
): boolean {
  return hasProblemCode(
    error,
    MILESTONE_DOCUMENT_REVIEW_ERROR_CODES.REVIEW_CHANGED,
  );
}

/**
 * 학생에게 하는 말. 서류 이름을 함께 부르는 것은 한 마일스톤에 서류가 여럿이기 때문이다 —
 * 목록 위에 뜨는 문구가 어느 줄의 이야기인지 말하지 않으면 학생은 멀쩡한 서류를 다시 낸다.
 *
 * 교직원 쪽 문구(`REVIEW_CONFLICT_LEAD`)와 **첫마디를 다르게** 쓴다. 여기서 막힌 사람은
 * 학생이고 그가 하려던 일은 제출이다 — 「검토하는 사이에」로 시작하면 학생이 검토를 하다
 * 막힌 것처럼 읽힌다.
 */
export function milestoneDocumentSubmitConflictNotice(
  documentName: string,
  result: MilestoneDocumentReloadResult,
): string {
  const lead = `제출하는 사이에 「${documentName}」에 교직원 검토 결과가 등록되어, 방금 제출은 저장되지 않았습니다.`;
  return result === 'reloaded'
    ? `${lead} 서류 상태를 다시 불러왔습니다 — 검토 내용을 확인한 뒤 진행해 주세요.`
    : `${lead} 서류 상태를 다시 불러오지 못했습니다 — 「다시 시도」로 불러온 뒤 검토 내용을 확인해 주세요.`;
}
