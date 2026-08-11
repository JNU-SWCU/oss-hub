import { Button } from '@/components/ui/button';

export interface SubmissionFormActionsProps {
  /** 제출 버튼 문구. 최초 제출은 「제출하기」, 재제출은 「제출본 N번 제출」이다. */
  readonly submitLabel: string;
  readonly submitting: boolean;
  readonly onCancel?: () => void;
}

/**
 * 제출 폼의 마지막 줄. 제출 창은 내용이 길면 세로로 스크롤되는데, 이 줄이 함께 밀려
 * 올라가면 「제출하기」가 보이는 영역 밖에 놓인다(1280×800에서 창이 열린 순간 200px
 * 아래). macOS의 겹침 스크롤막대는 스크롤하기 전까지 보이지 않으므로 더 내려갈 수
 * 있다는 신호도 없다 — 누른 줄 알았는데 빈 곳을 눌러 아무 일도 일어나지 않는다.
 *
 * 그래서 이 줄은 스크롤 상자 바닥에 붙여 둔다. 붙이려면 스크롤 상자와 이 줄 사이에
 * `overflow`가 걸린 조상이 없어야 하므로(카드는 `overflow-hidden`이다) 호출부는 이
 * 컴포넌트를 카드 **바깥**에 둔다.
 */
export function SubmissionFormActions({
  submitLabel,
  submitting,
  onCancel,
}: SubmissionFormActionsProps) {
  return (
    <div
      data-testid="submission-actions"
      // `after:`로 아래에 배경 한 겹을 더 깐다. sticky가 멈추는 선은 스크롤 상자의
      // **안쪽 여백을 뺀** 자리라, 이 줄만으로는 상자의 `pb-5 sm:pb-6`만큼 틈이 남아
      // 지나가는 내용이 버튼 밑으로 비친다. 높이는 그 여백과 같게 맞춘다. 클릭도 함께
      // 막는다 — 안 그러면 버튼 바로 아래를 눌렀을 때 뒤로 지나가던 입력이 눌린다.
      className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-background pt-4 pb-5 after:absolute after:inset-x-0 after:top-full after:h-5 after:bg-background sm:pb-6 sm:after:h-6"
    >
      <Button type="button" variant="outline" onClick={onCancel}>
        취소
      </Button>
      <Button type="submit" disabled={submitting}>
        {submitLabel}
      </Button>
    </div>
  );
}
