'use client';

import { useState, type FormEvent } from 'react';
import {
  BriefcaseBusiness,
  Circle,
  CircleCheckBig,
  GraduationCap,
} from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { StatusMessagePage } from '@/components/status-message-page';
import { ApiError } from '@/lib/api-client';

import { selectRole } from '../api';
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
  /** 선택 직후 안내 슬롯에 들어갈 내용. */
  readonly guidanceTitle: string;
  readonly guidanceDescription: string;
}

const ROLE_OPTIONS: readonly RoleOption[] = [
  {
    role: 'STUDENT',
    title: '학생',
    description: '프로그램을 찾아보고 개인 또는 팀으로 지원합니다.',
    note: '승인 없이 바로 시작합니다',
    noteClassName: 'text-status-approved-fg',
    guidanceTitle: '선택을 완료하면 바로 학생 화면으로 이동합니다',
    guidanceDescription:
      '모집 중인 프로그램을 둘러보고 개인 또는 팀으로 지원할 수 있습니다.',
  },
  {
    role: 'STAFF',
    title: '교직원',
    description: '프로그램을 만들고 지원자와 제출물을 관리합니다.',
    note: '관리자 승인이 필요합니다',
    noteClassName: 'text-status-pending-fg',
    guidanceTitle: '승인 후 교직원 기능을 사용할 수 있습니다',
    guidanceDescription:
      '요청을 제출하면 승인 상태를 확인할 수 있는 화면으로 이동합니다.',
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
 * 선택 상태를 색이 아니라 도형으로 알린다 — 링 색만으로는 색각 이상 사용자에게
 * 전달되지 않는다. 두 아이콘이 같은 크기라 상태가 바뀌어도 칸이 밀리지 않는다.
 */
function RoleSelectionMark({ isSelected }: { readonly isSelected: boolean }) {
  return isSelected ? (
    <CircleCheckBig aria-hidden="true" className="size-5 text-primary" />
  ) : (
    <Circle aria-hidden="true" className="size-5 text-muted-foreground/50" />
  );
}

/**
 * 역할별 다음 단계 안내가 들어갈 자리. 선택 전에도 같은 크기의 자리표시를
 * 그려 두어, 교직원을 눌러 안내가 나타나도 아래 제출 버튼이 움직이지 않는다.
 */
function RoleGuidanceSlot({
  selected,
}: {
  readonly selected: RoleOption | undefined;
}) {
  return (
    // 좁은 폭에서 안내가 한 줄 더 접히는 것까지 미리 담는 높이다.
    <div className="grid min-h-20" data-slot="role-guidance">
      {selected ? (
        <Alert data-role={selected.role}>
          <AlertTitle>{selected.guidanceTitle}</AlertTitle>
          <AlertDescription>{selected.guidanceDescription}</AlertDescription>
        </Alert>
      ) : (
        // Alert와 같은 상자 규격(gap-0.5 / rounded-lg / px-2.5 py-2 / text-sm)을
        // 그대로 써서, 자리표시와 실제 안내의 높이가 어긋나지 않게 한다.
        <div
          data-role="none"
          className="grid gap-0.5 rounded-lg border border-dashed border-border px-2.5 py-2 text-left text-sm text-muted-foreground"
        >
          <span className="font-medium">다음 단계 안내</span>
          <span>역할을 고르면 다음 단계 안내가 여기에 표시됩니다.</span>
        </div>
      )}
    </div>
  );
}

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
    <StatusMessagePage
      // 이 화면 위에는 공통 셸 nav와 온보딩 단계 표시가 이미 자리를 쓴다.
      // 기본값인 `min-h-dvh`는 그 높이를 모르기 때문에 합계가 항상 한 화면을
      // 넘어 스크롤이 생겼다. 위쪽 크롬(약 134px)만큼 빼서 노트북·외장 모니터
      // 모두 스크롤 없이 들어오게 한다.
      className="min-h-[calc(100dvh-9rem)]"
      title="역할을 선택해 주세요"
      description="선택한 역할에 맞는 화면과 기능을 안내합니다."
      action={
        // 부모가 `items-center`라 폭이 내용에 따라 정해진다 — `w-full`로 두면
        // 안내가 나타날 때 폼 전체가 옆으로도 벌어졌다. 뷰포트 기준 고정 폭을
        // 줘서 폭이 상태와 무관하게 유지되고, 위 단계 표시(max-w-2xl + px-4)와
        // 좌우가 맞는다.
        <form
          className="flex w-[min(100vw-2rem,40rem)] flex-col gap-3 text-left"
          onSubmit={handleSubmit}
        >
          <fieldset className="grid items-stretch gap-3 sm:grid-cols-2">
            <legend className="sr-only">사용할 역할</legend>
            {ROLE_OPTIONS.map((option) => {
              const isSelected = selectedRole === option.role;

              return (
                <label
                  key={option.role}
                  data-role={option.role}
                  data-selected={isSelected}
                  className="cursor-pointer rounded-xl outline-none focus-within:ring-3 focus-within:ring-ring/50"
                >
                  <input
                    className="peer sr-only"
                    type="radio"
                    name="role"
                    value={option.role}
                    checked={isSelected}
                    onChange={() => onSelect(option.role)}
                  />
                  <Card className="h-full transition-colors peer-checked:ring-2 peer-checked:ring-primary hover:bg-muted/40">
                    <CardHeader>
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                          <RoleIcon role={option.role} />
                        </span>
                        <RoleSelectionMark isSelected={isSelected} />
                      </div>
                      <CardTitle>{option.title}</CardTitle>
                      <CardDescription>{option.description}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <p
                        className={`text-xs font-medium ${option.noteClassName}`}
                      >
                        {option.note}
                      </p>
                    </CardContent>
                  </Card>
                </label>
              );
            })}
          </fieldset>

          <RoleGuidanceSlot selected={selectedOption} />

          {errorMessage ? (
            <Alert variant="destructive">
              <AlertTitle>역할을 저장하지 못했습니다</AlertTitle>
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          ) : null}

          {/* 터치 타깃 44px 확보 — lg 버튼 기본 높이(36px)로는 모자란다. */}
          <Button
            type="submit"
            size="lg"
            className="min-h-11 w-full"
            disabled={selectedRole === null || isSubmitting}
          >
            {isSubmitting ? '저장 중…' : '선택 완료'}
          </Button>
        </form>
      }
    />
  );
}

export function RoleSelectionScreen() {
  const [selectedRole, setSelectedRole] = useState<RoleSelection | null>(null);
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
      onSelect={setSelectedRole}
      onSubmit={() => void handleSubmit()}
    />
  );
}
