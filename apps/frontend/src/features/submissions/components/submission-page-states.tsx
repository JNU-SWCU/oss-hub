import Link from 'next/link';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { CreatedSubmission } from '../types';

export function SubmissionLoading({
  embedded = false,
}: {
  readonly embedded?: boolean;
}) {
  const content = (
    <>
      <div className="h-44 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
      <div className="h-80 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
    </>
  );
  return embedded ? (
    <div className="grid gap-6" aria-label="제출 정보 불러오는 중">
      {content}
    </div>
  ) : (
    <main
      className="mx-auto grid max-w-3xl gap-6 px-4 py-8"
      aria-label="제출 정보 불러오는 중"
    >
      {content}
    </main>
  );
}

export function SubmissionLoadFailure({
  embedded,
  message,
  onRetry,
}: {
  readonly embedded: boolean;
  readonly message: string;
  readonly onRetry: () => void;
}) {
  const failure = (
    <Alert variant="destructive">
      <AlertTitle>제출 정보 불러오기 실패</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>{message}</p>
        <Button type="button" onClick={onRetry}>
          다시 시도
        </Button>
      </AlertDescription>
    </Alert>
  );
  return embedded ? (
    <div className="grid gap-4">{failure}</div>
  ) : (
    <main className="mx-auto max-w-3xl px-4 py-8">{failure}</main>
  );
}

export function SubmissionSuccess({
  embedded,
  onClose,
  programId,
  submission,
}: {
  readonly embedded: boolean;
  readonly onClose?: () => void;
  readonly programId: string;
  readonly submission: CreatedSubmission;
}) {
  const submittedAt = new Date(submission.submittedAt).toLocaleString('ko-KR');
  if (embedded) {
    return (
      <div role="status" aria-live="polite" className="grid gap-4">
        <p className="font-medium">제출을 완료했습니다</p>
        <p className="text-sm text-muted-foreground">제출 시각 {submittedAt}</p>
        {onClose ? (
          <Button type="button" className="w-fit" onClick={onClose}>
            확인
          </Button>
        ) : null}
      </div>
    );
  }
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <Card role="status" aria-live="polite">
        <CardHeader>
          <CardTitle>제출을 완료했습니다</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            제출 시각 {submittedAt}
          </p>
          <Button asChild>
            <Link href={`/programs/${programId}`}>프로그램으로 돌아가기</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
