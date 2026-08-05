'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  BriefcaseBusiness,
  Circle,
  CircleCheckBig,
  GraduationCap,
} from 'lucide-react';

import {
  signupPrimaryClassName,
  SignupEyebrow,
  SignupLede,
  SignupTitle,
} from '@/components';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api-client';
import { cn } from '@/lib/utils';

import { fetchMyRoleRequest, fetchMyRoleSelection, selectRole } from '../api';
import type { RoleSelection } from '../types';

/**
 * 살아 있는 신청이 없어진 사람에게 **왜 그렇게 됐는지**를 알리는 안내(#673).
 *
 * 이 화면은 반려된 사용자가 실제로 도착하는 자리다(#535 — 회수·반려는 역할부터
 * 다시 고른다). 사유를 보여 주던 화면(`role-request-screen.tsx`의 `반려 사유`)은
 * `/onboarding/pending`에 사는데 게이트가 반려 사용자를 그리로 들이지 않으므로,
 * 그 안내는 아무도 볼 수 없는 죽은 경로가 됐다. 목적지를 옮기면서 목적지에 실어야
 * 할 정보를 함께 옮기지 않은 것이 이 결함이다.
 *
 * **회수(`REVOKED`)가 나중에 같은 자리에 들어온다.** 지금은 회수에 사유를 저장하지
 * 않아(`admin-access.repository.ts`의 `decidePendingRequest`가 반려에서만
 * `rejectionReason`을 남긴다) 범위 밖이지만, 붙게 되면 여기 `status`에 `'REVOKED'`를
 * 더하고 아래 `CLOSED_REQUEST_NOTICE`에 항목 하나만 추가하면 된다 — 표시 코드는
 * 상태를 직접 묻지 않고 이 표만 읽는다.
 */
export type ClosedRoleRequestStatus = 'REJECTED';

export interface ClosedRoleRequestNotice {
  readonly status: ClosedRoleRequestStatus;
  /** 관리자가 남긴 사유. 사유 없이 닫힌 과거 건은 `null`이다. */
  readonly reason: string | null;
}

interface ClosedRequestPresentation {
  readonly title: string;
  readonly description: string;
  readonly reasonLabel: string;
}

const CLOSED_REQUEST_NOTICE: Record<
  ClosedRoleRequestStatus,
  ClosedRequestPresentation
> = {
  REJECTED: {
    title: '교직원 요청이 반려되었습니다',
    // 다시 신청할 길을 별도 버튼으로 내지 않는다 — 이 화면의 `선택 완료`가 이미
    // 그 일을 한다(교직원을 다시 고르면 새 요청이 만들어진다). 버튼을 하나 더
    // 세우면 같은 일을 하는 조작이 둘이 되어 어느 쪽이 진짜인지 흐려진다.
    description:
      '아래에서 역할을 다시 고르면 새로 신청됩니다. 교직원을 다시 고르면 승인 요청이 한 번 더 접수됩니다.',
    reasonLabel: '반려 사유',
  },
};

/**
 * 화면에 실을 사유의 최대 길이.
 *
 * 사유에는 **길이 제한이 어디에도 없다** — 관리자 대화상자의 textarea에 `maxLength`가
 * 없고(`admin-access-mutation-reject-dialog.tsx`), DTO는 `@IsString()`뿐이며
 * (`patch-admin-access.dto.ts`) 저장은 `String?`이다. 그러니 표시 쪽이 자른다.
 * XSS는 React가 자동으로 이스케이프하므로 위험이 아니다(저장소 전체
 * `dangerouslySetInnerHTML` 0건) — 실제 위험은 화면이 밀려 `선택 완료` 버튼이
 * 접히는 선 아래로 내려가는 것이다.
 */
export const ROLE_REJECTION_REASON_MAX_LENGTH = 300;

/**
 * 표시할 사유를 만든다. 보여 줄 것이 없으면 `null`이라, 화면은 빈 상자를 그리지 않는다.
 *
 * 공백만 있는 사유도 없는 것으로 본다 — 상자만 뜨고 안이 비면 사용자는 사유가 아직
 * 안 온 줄 알고 기다린다. 반려 **사실**과 다시 신청하라는 안내는 사유가 없어도 남는다.
 */
export function clampRejectionReason(reason: string | null): string | null {
  const trimmed = reason?.trim() ?? '';
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed.length > ROLE_REJECTION_REASON_MAX_LENGTH
    ? `${trimmed.slice(0, ROLE_REJECTION_REASON_MAX_LENGTH)}…`
    : trimmed;
}

interface RoleSelectionFormProps {
  readonly selectedRole: RoleSelection | null;
  readonly isSubmitting: boolean;
  readonly errorMessage: string | null;
  /** 살아 있는 신청이 없어진 사유. 해당하지 않으면 `null`이라 아무것도 그리지 않는다. */
  readonly rejection: ClosedRoleRequestNotice | null;
  readonly onSelect: (role: RoleSelection) => void;
  readonly onSubmit: () => void;
}

interface RoleOption {
  readonly role: RoleSelection;
  readonly title: string;
  readonly description: string;
  /** 카드 하단 한 줄 요약. 두 카드 모두 이 줄을 가져야 높이가 같아진다. */
  readonly note: string;
  readonly noteClassName: string;
  /**
   * 선택 직후 안내 슬롯에 들어갈 내용.
   *
   * **두 역할 모두 다음 화면은 프로필 입력이다** — 백엔드 `roles.service.ts`가
   * 학생·교직원 모두에게 `/onboarding/profile`을 돌려준다. 교직원도 학과가 필수라
   * 역할을 골랐다고 가입이 끝나지 않기 때문이다. 여기서 "바로 학생 화면으로" ·
   * "승인 상태를 확인할 수 있는 화면으로"라고 말하던 때는, 사용자가 기대한 화면과
   * 실제 도착지가 서로 달랐다.
   *
   * **길이도 규칙이다.** 안내 슬롯은 높이를 미리 잡아 두어(`RoleGuidanceSlot`) 안내가
   * 나타나도 '선택 완료' 버튼이 움직이지 않는다. 그 여유가 좁은 폭에서 7.5px,
   * sm 이상에서 11px뿐이라(실측: 상자 88.5/69px, 슬롯 96/80px) 어느 문장이든 한 줄이
   * 더 생기면 버튼이 20px 밀린다. 문구를 고칠 때는 지금 길이(제목 20자 이내 ·
   * 설명 35자 이내)를 넘기지 말고, 넘겨야 한다면 슬롯 높이를 함께 다시 재라.
   */
  readonly guidanceTitle: string;
  readonly guidanceDescription: string;
}

const ROLE_OPTIONS: readonly RoleOption[] = [
  {
    role: 'STUDENT',
    title: '학생',
    description: '프로그램을 찾아보고 개인 또는 팀으로 지원합니다.',
    note: '승인 없이 바로 시작합니다',
    // 어두운 무대 위에서는 상태 토큰(`--status-*`)을 쓸 수 없다 — 밝은 표면 기준
    // 값이라(green-700 · amber-800) 바탕에 묻힌다. 대비가 검증된 --cosmos-* 안에서
    // "바로 갈 수 있다"는 초록(랜딩의 저장소 색)과 기다림의 흰색으로 나눈다.
    noteClassName: 'text-cosmos-repository',
    guidanceTitle: '기본 정보를 입력하면 가입이 끝납니다',
    guidanceDescription:
      '선택을 완료하면 이름·학번·학과를 입력하는 화면으로 이동합니다.',
  },
  {
    role: 'STAFF',
    title: '교직원',
    description: '프로그램을 만들고 지원자와 제출물을 관리합니다.',
    note: '관리자 승인이 필요합니다',
    noteClassName: 'text-cosmos-copy',
    guidanceTitle: '기본 정보를 입력한 뒤 승인을 기다립니다',
    guidanceDescription:
      '선택을 완료하면 이름·학과를 입력하는 화면으로 이동합니다.',
  },
];

interface DocumentNavigation {
  readonly assign: (path: string) => void;
}

export function navigateAfterRoleSelection(
  redirectTo: string,
  navigation: DocumentNavigation = window.location,
): void {
  navigation.assign(redirectTo);
}

function RoleIcon({ role }: { readonly role: RoleSelection }) {
  return role === 'STUDENT' ? (
    <GraduationCap className="size-5" />
  ) : (
    <BriefcaseBusiness className="size-5" />
  );
}

/**
 * 선택 상태를 색이 아니라 도형으로 알린다 — 테두리 밝기만으로는 색각 이상 사용자에게
 * 전달되지 않는다. 두 아이콘이 같은 크기라 상태가 바뀌어도 칸이 밀리지 않는다.
 */
function RoleSelectionMark({ isSelected }: { readonly isSelected: boolean }) {
  return isSelected ? (
    <CircleCheckBig aria-hidden="true" className="size-5 text-cosmos-copy" />
  ) : (
    <Circle aria-hidden="true" className="size-5 text-cosmos-muted/50" />
  );
}

/**
 * 역할별 다음 단계 안내가 들어갈 자리.
 *
 * 예전에는 선택 전에도 "역할을 고르면 안내가 여기에 표시됩니다"라는 빈 상자를 미리
 * 띄웠다. 아직 아무 정보도 없는 상자를 먼저 보여 주는 셈이라, 사용자는 읽을 것이
 * 있는 줄 알고 한 번 눈을 준 뒤 아무것도 얻지 못한다. 그래서 상자는 고른 뒤에만 그린다.
 *
 * 대신 **자리는 미리 비워 둔다**. 무대 본문이 세로 가운데 정렬이라 내용이 늘면 위아래로
 * 동시에 벌어져 화면 전체가 덜컥 움직인다 — 방금 누른 카드도 함께 움직이면 선택이
 * 실패한 것처럼 보인다. 높이는 실제로 재서 잡았다: 두 역할의 안내가 좁은 폭에서 89px,
 * sm 이상에서 69px이므로 각각 96·80으로 조금만 여유를 둔다. 더 크게 잡으면 고르기 전
 * 화면에 설명 없는 빈 띠가 남고, 작게 잡으면 안내가 나타날 때 버튼이 밀린다.
 *
 * `role="status"`는 내용이 아니라 이 껍데기에 건다 — 라이브 영역은 내용이 바뀌기
 * 전부터 문서에 있어야 스크린 리더가 변화를 읽는다.
 */
function RoleGuidanceSlot({
  selected,
}: {
  readonly selected: RoleOption | undefined;
}) {
  return (
    <div
      data-slot="role-guidance"
      role="status"
      className="min-h-24 sm:min-h-20"
    >
      {selected ? (
        <div
          data-role={selected.role}
          className="grid gap-1 rounded-card border border-cosmos-border bg-cosmos-muted/8 px-4 py-3 text-left break-keep"
        >
          <p className="text-small font-semibold text-cosmos-copy">
            {selected.guidanceTitle}
          </p>
          <p className="text-small text-cosmos-muted">
            {selected.guidanceDescription}
          </p>
        </div>
      ) : null}
    </div>
  );
}

/**
 * 반려 안내 상자.
 *
 * shadcn `Alert`를 쓰지 않는다 — 카드와 같은 이유다. `bg-card`·`bg-background`는
 * 반전 스코프가 덮는 변수 집합에 없어서(globals.css의 `[data-surface='inverted']`)
 * 어두운 무대 위에 흰 상자로 뜬다. 대비가 검증된 `--cosmos-*` 안에서, 바로 아래
 * `errorMessage` 상자와 같은 조형(`rounded-card` · `px-4 py-3` · 두 줄 위계)으로
 * 짓는다 — 같은 화면에서 경고가 두 가지 모양을 하면 위계가 무너진다.
 *
 * `RoleGuidanceSlot` 근처가 아니라 카드 **위**에 세운다. 그 슬롯은 높이를 실측해
 * 고정한 자리라(그 함수의 주석) 곁에 요소가 늘면 `선택 완료` 버튼이 밀린다.
 *
 * 사유는 관리자가 자유롭게 쓴 글이라 두 가지를 함께 건다. `whitespace-pre-wrap`은
 * 관리자가 넣은 줄바꿈을 살리고, `break-words`는 공백이 하나도 없는 긴 문자열이
 * 와도 상자 밖으로 밀고 나가지 못하게 끊는다(한글 문장은 `break-keep`이 자연스럽지만,
 * 여기서는 넘치지 않는 쪽이 먼저다). 길이 자체는 `clampRejectionReason`이 자른다.
 */
function ClosedRoleRequestAlert({
  notice,
}: {
  readonly notice: ClosedRoleRequestNotice;
}) {
  const presentation = CLOSED_REQUEST_NOTICE[notice.status];
  const reason = clampRejectionReason(notice.reason);

  return (
    <div
      role="alert"
      data-slot="role-request-closed"
      data-status={notice.status}
      className="grid gap-2 rounded-card border border-cosmos-danger/40 bg-cosmos-muted/8 px-4 py-3 text-left break-keep"
    >
      <p className="text-small font-semibold text-cosmos-danger">
        {presentation.title}
      </p>
      {reason === null ? null : (
        <p className="text-small text-cosmos-copy">
          <span className="font-medium">{presentation.reasonLabel}</span>
          <span className="mt-1 block break-words whitespace-pre-wrap">
            {reason}
          </span>
        </p>
      )}
      <p className="text-small text-cosmos-muted">{presentation.description}</p>
    </div>
  );
}

/**
 * 무대(`app/_shell/signup-stage.tsx`) 안에 들어가는 내용만 그린다.
 *
 * 조각들을 Fragment로 내보내는 것은 무대 본문이 세로 flex(`gap-8`)이기 때문이다 —
 * 한 겹 더 감싸면 배지·제목·리드가 그 리듬에서 떨어져 나와 가입 네 화면의 간격이
 * 서로 갈라진다.
 */
export function RoleSelectionForm({
  selectedRole,
  isSubmitting,
  errorMessage,
  rejection,
  onSelect,
  onSubmit,
}: RoleSelectionFormProps) {
  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    onSubmit();
  }

  const selectedOption = ROLE_OPTIONS.find(
    (option) => option.role === selectedRole,
  );

  return (
    <>
      <SignupEyebrow>STEP 2 / 3</SignupEyebrow>
      <SignupTitle>어떤 역할로 쓰시나요</SignupTitle>
      <SignupLede>고르신 역할에 맞춰 이후 화면과 기능이 정해집니다.</SignupLede>

      {/* 폭과 높이는 무대가 정한다. 예전에는 이 폼이 `min-h-[calc(100dvh-9rem)]`로 제
          높이를 직접 계산하고 `w-[min(100vw-2rem,40rem)]`로 폭을 고정했는데, 둘 다 가로
          진행 막대 시절의 셈이다. 진행 표시가 왼쪽 세로 눈금으로 옮겨 가면서 위쪽 크롬은
          헤더뿐이고(무대가 빼 준다), 폼은 기둥 안에서 늘어나므로 폭이 내용에 따라
          흔들리지 않는다 — 고정 폭은 오히려 좁은 화면에서 넘쳤다. */}
      <form
        className="flex flex-col gap-3 text-left sm:gap-4"
        onSubmit={handleSubmit}
      >
        {/* 리드 아래·카드 위. 왜 여기냐면, 사용자가 이 화면에서 할 일(역할 고르기)을
            읽기 **전에** 왜 다시 고르게 됐는지를 알아야 하기 때문이다. 카드 아래에
            두면 이미 고르고 나서야 사유를 만난다. 폼 안에 두는 이유는 무대 본문의
            간격(`gap-8`)이 아니라 폼의 간격(`gap-3`)을 따라야 카드에 붙어 보이기
            때문이다 — 무대 간격을 쓰면 안내가 화면 위쪽에 홀로 떨어진다. */}
        {rejection ? <ClosedRoleRequestAlert notice={rejection} /> : null}

        {/* 두 카드는 좁은 화면에서도 나란히 둔다. 세로로 쌓으면 카드 하나 높이(약
            190px)가 통째로 더해져 375×812에서 주 버튼이 접히는 선 아래로 내려갔다 —
            고를 것이 둘뿐인 화면에서 "고르고 누르기"가 한 화면에 안 들어오면 그게 더
            나쁘다. 둘을 나란히 두면 서로 비교하기도 쉽다. */}
        <fieldset className="grid grid-cols-2 items-stretch gap-3">
          <legend className="sr-only">사용할 역할</legend>
          {ROLE_OPTIONS.map((option) => {
            const isSelected = selectedRole === option.role;

            return (
              <label
                key={option.role}
                data-role={option.role}
                data-selected={isSelected}
                // 라디오는 sr-only라 포커스 테두리를 스스로 그리지 못한다. 링을 이 껍데기가
                // 대신 그린다 — 어두운 바탕에서는 기본 `--ring`(navy-400)이 거의 안 보여
                // 흰색을 쓴다.
                className="cursor-pointer rounded-card outline-none focus-within:ring-2 focus-within:ring-cosmos-copy"
              >
                <input
                  className="peer sr-only"
                  type="radio"
                  name="role"
                  value={option.role}
                  checked={isSelected}
                  onChange={() => onSelect(option.role)}
                />
                {/* shadcn `Card`를 쓰지 않는다 — `bg-card`는 반전 스코프가 덮는 변수 집합에
                  없어서(globals.css의 `[data-surface='inverted']`) 어두운 무대 위에 흰
                  상자로 뜬다. 무대와 같은 --cosmos-* 로 직접 짓는다. */}
                <div className="flex h-full flex-col gap-2 rounded-card border border-cosmos-border bg-cosmos-muted/8 p-4 transition-colors peer-checked:border-cosmos-copy hover:bg-cosmos-muted/15 motion-reduce:transition-none sm:p-5">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="flex size-9 items-center justify-center rounded-lg bg-cosmos-muted/10 text-cosmos-copy">
                      <RoleIcon role={option.role} />
                    </span>
                    <RoleSelectionMark isSelected={isSelected} />
                  </div>
                  <p className="font-heading text-body leading-snug font-semibold text-cosmos-copy">
                    {option.title}
                  </p>
                  <p className="text-small break-keep text-cosmos-muted">
                    {option.description}
                  </p>
                  {/* 두 카드의 이 줄이 항상 바닥에 붙어야 나란한 카드의 눈높이가 맞는다. */}
                  <p
                    className={cn(
                      'mt-auto pt-1 text-xs font-medium sm:pt-2',
                      option.noteClassName,
                    )}
                  >
                    {option.note}
                  </p>
                </div>
              </label>
            );
          })}
        </fieldset>

        <RoleGuidanceSlot selected={selectedOption} />

        {errorMessage ? (
          // 오류도 같은 이유로 shadcn `Alert` 대신 직접 짓는다. `--destructive`는 반전
          // 스코프가 밝은 붉은색으로 덮어 주므로 글자색만 그대로 쓴다.
          <div
            role="alert"
            className="grid gap-1 rounded-card border border-destructive/40 px-4 py-3 break-keep"
          >
            <p className="text-small font-semibold text-destructive">
              역할을 저장하지 못했습니다
            </p>
            <p className="text-small text-cosmos-muted">{errorMessage}</p>
          </div>
        ) : null}

        {/* 터치 타깃 44px 확보 — lg 버튼 기본 높이(36px)로는 모자란다. 좁은 화면에서만
          폭을 채우고 넓어지면 글자 길이만큼만 차지한다. */}
        <Button
          type="submit"
          size="lg"
          className={cn('min-h-11 w-full sm:w-fit', signupPrimaryClassName)}
          disabled={selectedRole === null || isSubmitting}
        >
          {isSubmitting ? '저장 중…' : '선택 완료'}
        </Button>
      </form>
    </>
  );
}

/**
 * 되돌아온 사람에게 이전 선택을 되살린다(#569).
 *
 * 확정을 `가입 마치기`로 미루면서 프로필 화면에서 여기로 되돌아올 수 있게 됐다.
 * 되돌아왔는데 아무것도 골라지지 않은 화면이 뜨면, 사용자는 자기가 무엇을 골랐었는지
 * 화면에서 확인할 수 없어 방금 한 선택이 지워진 것으로 읽는다.
 *
 * **사용자가 이미 카드를 눌렀으면 덮어쓰지 않는다.** 조회는 화면이 뜬 뒤에 끝나므로,
 * 그 사이에 고른 것을 뒤늦게 도착한 응답이 되돌리면 눌렀던 카드가 저절로 바뀐다.
 *
 * 반려 사유도 같은 effect에서 함께 읽는다(#673). 게이트가 이미 읽어 둔 스냅샷을
 * 물려받는 길은 막혀 있다 — 그 값은 `app/_shell`에 있고 `features`는 `app`을
 * import할 수 없다(`eslint.config.mjs`). 그래서 이 화면이 직접 읽는다. 두 조회를
 * 한 자리에 두면 취소(`AbortController`)도 한 번에 걸린다.
 *
 * **반려(`REJECTED`)일 때만 남긴다.** 재요청이 접수돼 `PENDING`이 되면 조건에서
 * 빠지므로 안내는 저절로 사라진다 — 사라지는 것을 따로 처리하지 않는 편이 안전하다.
 */
function useRestoredRoleSelection(): {
  readonly selectedRole: RoleSelection | null;
  readonly rejection: ClosedRoleRequestNotice | null;
  readonly select: (role: RoleSelection) => void;
} {
  const [selectedRole, setSelectedRole] = useState<RoleSelection | null>(null);
  const [rejection, setRejection] = useState<ClosedRoleRequestNotice | null>(
    null,
  );
  const hasChosen = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    fetchMyRoleSelection(controller.signal)
      .then((state) => {
        if (!controller.signal.aborted && !hasChosen.current) {
          setSelectedRole(state.selectedRole);
        }
      })
      .catch(() => {
        // 되살리기에 실패해도 화면은 그대로 쓸 수 있다 — 아무것도 고르지 않은 상태로
        // 시작할 뿐이다. 여기서 오류를 띄우면 처음 온 사람(고른 것이 없는 것이 정상)
        // 에게도 실패 화면이 뜬다.
      });
    fetchMyRoleRequest(controller.signal)
      .then((request) => {
        if (!controller.signal.aborted && request?.status === 'REJECTED') {
          setRejection({
            status: 'REJECTED',
            reason: request.rejectionReason,
          });
        }
      })
      .catch(() => {
        // 같은 정책이다 — 사유를 못 읽어도 화면은 그대로 쓸 수 있다. 안내만 없고
        // 역할은 다시 고를 수 있다. 여기서 실패 화면을 띄우면 반려와 무관한
        // 사용자(요청이 없는 것이 정상인 첫 가입자)까지 함께 막힌다.
      });
    return () => controller.abort();
  }, []);

  return {
    selectedRole,
    rejection,
    select: (role) => {
      hasChosen.current = true;
      setSelectedRole(role);
    },
  };
}

export function RoleSelectionScreen() {
  const { selectedRole, rejection, select } = useRestoredRoleSelection();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(): Promise<void> {
    if (selectedRole === null || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const result = await selectRole(selectedRole);
      navigateAfterRoleSelection(result.redirectTo);
    } catch (error) {
      if (error instanceof ApiError) {
        setErrorMessage(error.message);
      } else {
        setErrorMessage('잠시 후 다시 시도해 주세요.');
      }
      setIsSubmitting(false);
    }
  }

  return (
    <RoleSelectionForm
      selectedRole={selectedRole}
      isSubmitting={isSubmitting}
      errorMessage={errorMessage}
      rejection={rejection}
      onSelect={select}
      onSubmit={() => void handleSubmit()}
    />
  );
}
