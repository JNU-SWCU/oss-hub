import Link from 'next/link';

import { Button } from '@/components/ui/button';

interface ParticipantOnlyNoticeProps {
  description: string;

  applyHref: string;

  overviewHref: string;
}

function ParticipantOnlyNotice({
  description,
  applyHref,
  overviewHref,
}: ParticipantOnlyNoticeProps) {
  return (
    <section
      data-slot="participant-only-notice"
      aria-labelledby="participant-only-heading"
      className="flex min-h-[50svh] flex-col items-center justify-center gap-4 px-6 py-16 text-center"
    >
      <div className="space-y-1">
        <h2
          id="participant-only-heading"
          className="font-heading text-lg font-semibold text-foreground"
        >
          아직 참여자가 아닙니다
        </h2>
        <p className="mx-auto max-w-md break-keep text-sm text-muted-foreground">
          {description}
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button asChild className="min-h-11" size="sm">
          <Link href={applyHref}>신청하러 가기</Link>
        </Button>
        <Button asChild className="min-h-11" variant="outline" size="sm">
          <Link href={overviewHref}>프로그램 개요로</Link>
        </Button>
      </div>
    </section>
  );
}

export { ParticipantOnlyNotice };
