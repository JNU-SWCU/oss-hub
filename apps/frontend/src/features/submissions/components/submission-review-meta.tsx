import type { ChecklistSubmission } from '../types';
import { SubmissionFileLink } from './submission-checklist-row';
import { formatDeadline } from './submission-form-view';
const REVIEW_DECISION_LABELS = {
  APPROVED: '승인',
  REJECTED: '반려',
  CHANGES_REQUESTED: '보완 요청',
} as const;

export function SubmissionReviewMeta({
  submission,
}: {
  readonly submission: ChecklistSubmission;
}) {
  return (
    <dl className="grid gap-2 text-sm sm:grid-cols-2">
      {submission.file !== null ? (
        <div className="sm:col-span-2">
          <dt className="font-medium">제출 파일</dt>
          <dd className="mt-1">
            <SubmissionFileLink file={submission.file} />
          </dd>
        </div>
      ) : null}
      {submission.decision !== null ? (
        <div>
          <dt className="font-medium">결과</dt>
          <dd className="text-muted-foreground">
            {REVIEW_DECISION_LABELS[submission.decision]}
          </dd>
        </div>
      ) : null}
      {submission.reviewComment !== null ? (
        <div>
          <dt className="font-medium">교직원 코멘트</dt>
          <dd className="whitespace-pre-wrap text-muted-foreground">
            {submission.reviewComment}
          </dd>
        </div>
      ) : null}
      {submission.lastReviewedAt !== null ? (
        <div>
          <dt className="font-medium">검토 시각</dt>
          <dd className="text-muted-foreground">
            {formatDeadline(submission.lastReviewedAt)}
          </dd>
        </div>
      ) : null}
    </dl>
  );
}
