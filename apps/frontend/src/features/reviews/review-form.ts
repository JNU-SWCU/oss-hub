import type { ReviewDecision } from './types';

export type ReviewDecisionInput = ReviewDecision | '';

export type ReviewFormState = {
  readonly decision: ReviewDecisionInput;
  readonly comment: string;
};

export const INITIAL_REVIEW_FORM_STATE: ReviewFormState = {
  decision: '',
  comment: '',
};

export type ReviewFormAction =
  | {
      readonly kind: 'decision-changed';
      readonly decision: ReviewDecision;
    }
  | {
      readonly kind: 'comment-changed';
      readonly comment: string;
    }
  | { readonly kind: 'stale-reloaded' };

function assertNever(value: never): never {
  throw new TypeError(`unhandled review form action: ${String(value)}`);
}

export function reviewFormReducer(
  state: ReviewFormState,
  action: ReviewFormAction,
): ReviewFormState {
  switch (action.kind) {
    case 'decision-changed':
      return { ...state, decision: action.decision };
    case 'comment-changed':
      return { ...state, comment: action.comment };
    case 'stale-reloaded':
      return INITIAL_REVIEW_FORM_STATE;
    default:
      return assertNever(action);
  }
}

export function reviewFormError(
  decision: ReviewDecisionInput,
  comment: string,
): string | null {
  if (decision === '') return '판정을 선택해 주세요.';
  if (
    (decision === 'CHANGES_REQUESTED' || decision === 'REJECTED') &&
    comment.trim() === ''
  ) {
    return '보완 요청과 최종 반려에는 코멘트가 필요합니다.';
  }
  return null;
}
