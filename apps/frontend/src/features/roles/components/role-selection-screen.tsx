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

import { fetchMyRoleSelection, selectRole } from '../api';
import type { RoleSelection } from '../types';

interface RoleSelectionFormProps {
  readonly selectedRole: RoleSelection | null;
  readonly isSubmitting: boolean;
  readonly errorMessage: string | null;
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
 */
function useRestoredRoleSelection(): {
  readonly selectedRole: RoleSelection | null;
  readonly select: (role: RoleSelection) => void;
} {
  const [selectedRole, setSelectedRole] = useState<RoleSelection | null>(null);
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
    return () => controller.abort();
  }, []);

  return {
    selectedRole,
    select: (role) => {
      hasChosen.current = true;
      setSelectedRole(role);
    },
  };
}

export function RoleSelectionScreen() {
  const { selectedRole, select } = useRestoredRoleSelection();
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
      onSelect={select}
      onSubmit={() => void handleSubmit()}
    />
  );
}
