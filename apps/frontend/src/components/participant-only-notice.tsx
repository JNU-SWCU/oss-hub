import Link from 'next/link';

import { Button } from '@/components/ui/button';

interface ParticipantOnlyNoticeProps {
  /** 이 화면이 참여자에게 무엇을 주는지 — 화면마다 다르므로 호출부가 정한다. */
  description: string;
  /** 신청 화면. 모집이 닫혔거나 이미 낸 신청이 있으면 그 화면이 이유를 설명한다. */
  applyHref: string;
  /** 참여 전에도 열리는 화면 — 막다른 길로 남지 않게 돌아갈 곳을 함께 준다. */
  overviewHref: string;
}

/**
 * 승인된 신청이 없는 학생이 참여자 전용 화면에 **주소로 직접** 들어왔을 때의 안내(#1099).
 *
 * 이 자리에는 빨간 실패 상자가 서 있었다("체크리스트 불러오기 실패" + 「다시 시도」).
 * 서버는 403으로 정확히 답했는데 화면이 그것을 다른 실패와 같은 모양으로 접었고, 눌러도
 * 같은 실패가 반복돼 학생에게는 고장으로 읽혔다. 이것은 실패가 아니라 **아직 참여자가
 * 아닌 상태**이므로 상태로 그리고 다음 행동을 준다 — `role="alert"`도 「다시 시도」도
 * 두지 않는다(docs/design.md §피드백·알림: 정적 초기 렌더에는 live region을 두지 않는다).
 *
 * `AccessDenied`·`LoginRequiredNotice`와 같은 뼈대(가운데 정렬 + `min-h-[50svh]` + 제목·
 * 한 문단·돌아갈 곳)를 쓴다. 제목은 `h2`다 — 게시판은 위에 `PageHeader`의 `h1`이 이미 있고,
 * 서류 화면의 이웃 상태(`내 제출물`)도 `h2`라 두 화면에서 같은 단계가 된다.
 */
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
export type { ParticipantOnlyNoticeProps };
