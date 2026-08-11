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
                  : // 사유 원문은 여기에 싣지 않는다 — 대시보드 알림 payload에 그런
                    // 필드가 없다. 대신 사유가 실제로 있는 곳(`noticePath`가 가리키는
                    // 신청 상세)을 정확히 가리킨다. 예전 문구("상태를 확인해 주세요")는
                    // 그 화면이 상태만 말하고 이유는 말하지 않던 때의 말이라, 눌러 간
                    // 사람이 아무것도 얻지 못했다(#722).
                    '신청 상세에서 반려 사유를 확인해 주세요.'}
              </p>
              <Link
                href={noticePath(notice)}
                className="inline-flex min-h-10 items-center gap-1 font-semibold"
              >
                {approved ? '제출 일정 확인' : '반려 사유 확인'}
                <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
            </AlertDescription>
          </Alert>
        );
      })}
    </section>
  );
}
