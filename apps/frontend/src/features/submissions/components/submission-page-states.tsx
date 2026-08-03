import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type { CreatedSubmission } from '../types';

export function SubmissionLoading() {
  return (
    <div className="grid gap-6" aria-label="제출 정보 불러오는 중">
      <div className="h-44 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
      <div className="h-80 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
    </div>
  );
}

export function SubmissionLoadFailure({
  message,
  onRetry,
}: {
  readonly message: string;
  readonly onRetry: () => void;
}) {
  return (
    <div className="grid gap-4">
      <Alert variant="destructive">
        <AlertTitle>제출 정보 불러오기 실패</AlertTitle>
        <AlertDescription className="space-y-3">
          <p>{message}</p>
          <Button type="button" onClick={onRetry}>
            다시 시도
          </Button>
        </AlertDescription>
      </Alert>
    </div>
  );
}

export function SubmissionSuccess({
  onClose,
  submission,
}: {
  readonly onClose: () => void;
  readonly submission: CreatedSubmission;
}) {
  const submittedAt = new Date(submission.submittedAt).toLocaleString('ko-KR');
  return (
    <div role="status" aria-live="polite" className="grid gap-4">
      <p className="font-medium">제출을 완료했습니다</p>
      <p className="text-sm text-muted-foreground">제출 시각 {submittedAt}</p>
      <Button type="button" className="w-fit" onClick={onClose}>
        확인
      </Button>
    </div>
  );
}
