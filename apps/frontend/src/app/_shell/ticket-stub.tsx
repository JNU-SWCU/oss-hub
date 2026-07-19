import { EmptyState } from '@/components';

/**
 * 화면 티켓 스텁(#136 최소 요구 2) — EmptyState + "이 화면은 #NNN에서
 * 구현됩니다" + 티켓 링크로만 채운다. 그 이상 구현하지 않는다.
 */
export function TicketStub({
  ticketNumber,
  title,
}: {
  ticketNumber: number;
  title: string;
}) {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-2xl items-center px-4">
      <EmptyState
        title={title}
        description={`이 화면은 #${ticketNumber}에서 구현됩니다.`}
        action={
          <a
            href={`https://github.com/JNU-SWCU/oss-hub/issues/${ticketNumber}`}
            target="_blank"
            rel="noreferrer"
            className="text-sm font-medium text-primary underline underline-offset-4"
          >
            #{ticketNumber} 티켓 보기
          </a>
        }
      />
    </main>
  );
}
