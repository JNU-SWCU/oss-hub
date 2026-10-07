import { EmptyState } from '@/components';

export function TicketStub({
  ticketNumber,
  title,
}: {
  ticketNumber: number;
  title: string;
}) {
  return (
    <main className="mx-auto flex w-full min-h-[60vh] max-w-2xl items-center px-4">
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
