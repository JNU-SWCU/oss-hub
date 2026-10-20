import { Info } from 'lucide-react';
import Link from 'next/link';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type { TeamDeletionNotice } from '../types';

const deletionTime = new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Seoul',
});

export function TeamDeletionNotices({
  notices,
  onRead,
}: {
  readonly notices: readonly TeamDeletionNotice[];
  readonly onRead: (notificationId: string) => void;
}) {
  if (notices.length === 0) return null;
  return (
    <section aria-label="팀 삭제 알림" className="space-y-3">
      {notices.map((notice) => (
        <Alert key={notice.id}>
          <Info aria-hidden="true" />
          <AlertTitle className="break-keep">
            {notice.programName}의 팀 ‘{notice.teamName}’이 삭제되었습니다
          </AlertTitle>
          <AlertDescription className="space-y-2 break-keep">
            <p>
              <time dateTime={notice.deletedAt} className="whitespace-nowrap">
                {deletionTime.format(new Date(notice.deletedAt))}
              </time>
              에 삭제되었습니다.
            </p>
            <p>
              삭제 사유: {notice.message?.trim() || '등록된 사유가 없습니다.'}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button asChild variant="outline">
                <Link
                  href={`/programs/${encodeURIComponent(notice.programId)}`}
                >
                  프로그램 확인
                </Link>
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onRead(notice.id)}
              >
                확인했어요
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ))}
    </section>
  );
}
