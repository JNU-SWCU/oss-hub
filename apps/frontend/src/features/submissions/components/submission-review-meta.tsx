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
      {/*
        제출본 번호는 여기 한 곳에서만 적는다. 예전에는 패널 문장("제출본 1번이
        …")과 재제출 폼의 별도 목록이 같은 수를 두 번 말했다.
      */}
      <div>
        <dt className="font-medium">현재 제출본</dt>
        <dd className="text-muted-foreground">
          {submission.currentRevision}번
        </dd>
      </div>
      {submission.file !== null ? (
        <div className="sm:col-span-2">
          <dt className="font-medium">제출 파일</dt>
          <dd className="mt-1">
            <SubmissionFileLink file={submission.file} />
          </dd>
        </div>
      ) : null}
      {/*
        심사 결과가 지금 상태 그 자체면(승인·반려) 배지가 이미 말한 말이라 다시 적지
        않는다. 상태와 결과가 갈라지는 때(예: 보완 요청을 받고 다시 낸 제출이
        검토 대기일 때)만 지난 심사가 무엇이었는지를 그 이름으로 남긴다.
      */}
      {submission.decision !== null &&
      submission.decision !== submission.status ? (
        <div>
          <dt className="font-medium">최근 검토 결과</dt>
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
