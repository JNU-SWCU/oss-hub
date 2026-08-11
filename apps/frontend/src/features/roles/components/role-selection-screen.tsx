'use client';

import { useState, type FormEvent } from 'react';
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
import { clampRejectionReason } from '@/lib/display-text';
import { cn } from '@/lib/utils';

import { selectRole } from '../api';
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
    //
    // **한 문장이어야 한다.** 예전에는 "아래에서 역할을 다시 고르면 새로 신청됩니다.
    // 교직원을 다시 고르면 승인 요청이 한 번 더 접수됩니다."로 두 문장이었는데, 둘이
    // 같은 말을 하면서 375px에서 설명만 59px를 먹었다. 고를 카드와 `선택 완료`가
    // 바로 아래 보이는 화면이라 두 번째 문장은 잉여였다. 이 상자의 높이가 곧
    // 사용자가 감수할 스크롤이라(아래 `ClosedRoleRequestAlert` 주석의 실측) 문구를
    // 늘릴 때는 그 숫자를 다시 재라.
    description: '아래에서 교직원을 다시 고르면 승인 요청이 새로 접수됩니다.',
    reasonLabel: '반려 사유',
  },
};

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
 * ⚠ **이 상자는 `선택 완료` 버튼을 375×812의 접히는 선 아래로 밀어낸다. 알고 한
 * 일이다 — 회귀가 아니니 되돌리지 마라.**
 *
 * 실측(2026-08-05). 사유 길이는 관리자가 정하므로 **두 줄짜리 사유**를 기준으로 잡았다
 * — 아래 표의 202px가 그 값이다. 검토 픽스처(`role-rejected`)는 그보다 짧은 한 줄이라
 * 163px·버튼 하단 890px로 나온다. 어느 쪽이든 접히는 선(812) 아래인 것은 같고,
 * **사유가 길수록 더 내려간다**는 것이 이 표의 요지다.
 *
 * | 375×812 | 버튼 하단 | 화면 안 | 문서 높이 | 안내 높이 |
 * |---|---|---|---|---|
 * | 안내 없음 | 732px | 예 | 812(스크롤 0) | — |
 * | 안내 있음(두 줄 사유) | 929px | **아니오** | 993 | 202 |
 * | 안내 있음(한 줄 사유) | 890px | **아니오** | 954 | 163 |
 *
 * 1440×900에서는 739.3px → 819px로 **둘 다 화면 안**이다(문서 900, 스크롤 0, 안내
 * 143.5px). 대가는 좁은 화면에만 생긴다.
 *
 * 안내 202px의 내역(합이 정확히 맞는다): 제목 19.5 · 사유 블록 101.5 · 설명 39 ·
 * 안쪽 여백 24 · **테두리 2** · 간격 16. 테두리를 빼먹거나 앞의 두 값을 정수로
 * 올림하면 201이 나온다 — 다시 잴 때 이 함정을 조심하라.
 *
 * 아래 카드 배치 주석이 지키는 "고르고 누르기가 한 화면에" 제약을 여기서
 * **의도적으로 양보한 것**이다.
 *
 * 왜 양보하는가. 그 제약은 **읽을 것이 없는 첫 가입 동선**을 전제로 쓰였다. 반려된
 * 사용자의 첫 할 일은 고르고 누르기가 아니라 **왜인지 읽기**다 — 이유를 모른 채 다시
 * 고르면 같은 이유로 또 반려된다. 그리고 버튼을 화면 안에 두려면 안내가 85px 이하여야
 * 하는데 제목(20) + 사유 두 줄(약 40) + 안쪽 여백(24) + 간격(8) = 92px라, 375에서
 * **사유를 그대로 보여 주면서 버튼을 화면 안에 두는 조합은 존재하지 않는다.** 사유를
 * 접어 숨기면 가능하지만 그것은 이 화면이 고치려는 결함(사유가 사용자에게 닿지 않는다)을
 * 절반 되살리는 일이라 택하지 않았다.
 *
 * 대신 대가는 줄인다. 설명을 두 문장에서 한 문장으로 묶어 59px→39px, 상자 전체
 * 222px→202px, 버튼 하단 949px→929px로 낮췄다(위 `CLOSED_REQUEST_NOTICE` 주석).
 * 사유는 길이를 자른다(`clampRejectionReason`). 문구나 구조를 늘릴 때는 위 표를
 * 다시 재라 — 지금 상태가 "허용한 최대"이지 "여유"가 아니다.
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
            나쁘다. 둘을 나란히 두면 서로 비교하기도 쉽다.

            **단 반려 안내가 서 있을 때는 예외다** — 그때는 버튼이 접히는 선 아래로
            내려가는 것을 알고 허용했다(위 `ClosedRoleRequestAlert` 주석의 실측과 근거).
            이 가로 배치 자체는 안내와 무관하게 그대로 지킨다: 여기서 세로로 쌓으면
            안내가 없는 첫 가입자까지 함께 스크롤하게 된다. */}
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
 * 이 화면이 그리는 데 필요한 것 전부. **스스로 조회하지 않는다.**
 *
 * 예전에는 이 컴포넌트가 `fetchMyRoleSelection`·`fetchMyRoleRequest`를 직접 불렀다.
 * 그런데 이 화면을 여는 `OnboardingGate`는 그 두 값을 **이미 읽어서** 접근을 판단한
 * 뒤다(`app/_shell/use-session-role.ts`). 같은 것을 두 번 묻는 셈이고, 더 나쁘게는
 * 두 답이 서로 다른 순간의 값일 수 있다 — 게이트는 반려로 판단해 이 화면을 열어
 * 줬는데 화면의 두 번째 조회가 실패하면 **사유 없는 역할 선택 화면**이 뜬다. #673이
 * 고치려는 결함이 네트워크가 흔들릴 때마다 되살아나는 통로였다.
 *
 * 그래서 값은 전부 prop으로 받는다. 게이트가 판단에 쓴 스냅샷을 `app` 계층이
 * (`app/onboarding/role/role-selection-route.tsx`) 풀어서 내려 준다 — `features`는
 * `app`을 import할 수 없으므로 방향이 이쪽이어야 한다.
 */
interface RoleSelectionScreenProps {
  /**
   * 되돌아온 사람에게 되살릴 이전 선택(#569).
   *
   * 확정을 `가입 마치기`로 미루면서 프로필 화면에서 여기로 되돌아올 수 있게 됐다.
   * 되돌아왔는데 아무것도 골라지지 않은 화면이 뜨면, 사용자는 자기가 무엇을
   * 골랐었는지 화면에서 확인할 수 없어 방금 한 선택이 지워진 것으로 읽는다.
   *
   * **이 값은 첫 상태로만 쓰고 이후에는 따라가지 않는다.** #569가 `hasChosen` ref로
   * 막던 것이 바로 그것이다 — 사용자가 카드를 누른 뒤 뒤늦게 도착한 응답이 선택을
   * 되돌리면 눌렀던 카드가 저절로 바뀐다. 이제는 ref가 필요 없다: 게이트가 두 조회가
   * **끝난 뒤에만** 자식을 그리므로(`status === 'unassigned'`는 `loaded`를 전제한다)
   * 뒤늦게 도착하는 응답 자체가 없고, `useState` 초기값은 이후 prop 변화를 무시한다.
   */
  readonly initialSelectedRole: RoleSelection | null;
  /** 살아 있는 신청이 없어진 사유. 해당하지 않으면 `null`이다. */
  readonly rejection: ClosedRoleRequestNotice | null;
}

export function RoleSelectionScreen({
  initialSelectedRole,
  rejection,
}: RoleSelectionScreenProps) {
  const [selectedRole, setSelectedRole] = useState<RoleSelection | null>(
    initialSelectedRole,
  );
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
      onSelect={setSelectedRole}
      onSubmit={() => void handleSubmit()}
    />
  );
}
