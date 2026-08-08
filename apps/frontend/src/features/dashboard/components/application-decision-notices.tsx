import { AlertCircle, ArrowRight, CircleCheck } from 'lucide-react';
import Link from 'next/link';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { ApplicationDecisionNotice } from '../types';

const decisionTime = new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Seoul',
});

function noticePath(notice: ApplicationDecisionNotice): string {
  const programId = encodeURIComponent(notice.programId);
  return notice.decision === 'APPROVED'
    ? `/programs/${programId}/submissions`
    : `/programs/${programId}/apply`;
}

export function ApplicationDecisionNotices({
  notices,
}: {
  readonly notices: readonly ApplicationDecisionNotice[];
}) {
  if (notices.length === 0) return null;

  return (
    <section aria-label="신청 결과 알림" className="space-y-3">
      {notices.map((notice) => {
        const approved = notice.decision === 'APPROVED';
        return (
          <Alert key={notice.id} variant={approved ? 'default' : 'destructive'}>
            {approved ? (
              <CircleCheck aria-hidden="true" />
            ) : (
              <AlertCircle aria-hidden="true" />
            )}
            <AlertTitle className="[word-break:keep-all]">
              {notice.programName} 신청이{' '}
              {approved ? '승인되었습니다' : '반려되었습니다'}
            </AlertTitle>
            <AlertDescription className="space-y-2 [word-break:keep-all]">
              <p>
                {decisionTime.format(new Date(notice.decidedAt))}에
                처리되었습니다.{' '}
                {approved
                  ? '다음 제출 일정과 준비할 내용을 확인해 주세요.'
                  : '신청 상세에서 상태를 확인해 주세요.'}
              </p>
              <Link
                href={noticePath(notice)}
                className="inline-flex min-h-10 items-center gap-1 font-semibold"
              >
                {approved ? '제출 일정 확인' : '신청 상세 확인'}
                <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
            </AlertDescription>
          </Alert>
        );
      })}
    </section>
  );
}
