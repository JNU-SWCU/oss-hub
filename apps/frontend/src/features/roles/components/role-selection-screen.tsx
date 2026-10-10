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

type ClosedStaffAccessRequestStatus = 'REJECTED';

export interface ClosedStaffAccessRequestNotice {
  readonly status: ClosedStaffAccessRequestStatus;

  readonly reason: string | null;
}

interface ClosedRequestPresentation {
  readonly title: string;
  readonly description: string;
  readonly reasonLabel: string;
}

const CLOSED_REQUEST_NOTICE: Record<
  ClosedStaffAccessRequestStatus,
  ClosedRequestPresentation
> = {
  REJECTED: {
    title: '교직원 요청이 반려되었습니다',

    description: '아래에서 교직원을 다시 고르면 승인 요청이 새로 접수됩니다.',
    reasonLabel: '반려 사유',
  },
};

interface RoleSelectionFormProps {
  readonly selectedRole: RoleSelection | null;
  readonly isSubmitting: boolean;
  readonly errorMessage: string | null;

  readonly rejection: ClosedStaffAccessRequestNotice | null;
  readonly onSelect: (role: RoleSelection) => void;
  readonly onSubmit: () => void;
}

interface RoleOption {
  readonly role: RoleSelection;
  readonly title: string;
  readonly description: string;

  readonly note: string;
  readonly noteClassName: string;

  readonly guidanceTitle: string;
  readonly guidanceDescription: string;
}

const ROLE_OPTIONS: readonly RoleOption[] = [
  {
    role: 'STUDENT',
    title: '학생',
    description: '프로그램을 찾아보고 개인 또는 팀으로 지원합니다.',
    note: '학생 가입에는 승인이 필요하지 않습니다',

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

function RoleSelectionMark({ isSelected }: { readonly isSelected: boolean }) {
  return isSelected ? (
    <CircleCheckBig aria-hidden="true" className="size-5 text-cosmos-copy" />
  ) : (
    <Circle aria-hidden="true" className="size-5 text-cosmos-muted/50" />
  );
}

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

function ClosedStaffAccessRequestAlert({
  notice,
}: {
  readonly notice: ClosedStaffAccessRequestNotice;
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

      <form
        className="flex flex-col gap-3 text-left sm:gap-4"
        onSubmit={handleSubmit}
      >
        {rejection ? (
          <ClosedStaffAccessRequestAlert notice={rejection} />
        ) : null}

        <fieldset className="grid grid-cols-2 items-stretch gap-3">
          <legend className="sr-only">사용할 역할</legend>
          {ROLE_OPTIONS.map((option) => {
            const isSelected = selectedRole === option.role;

            return (
              <label
                key={option.role}
                data-role={option.role}
                data-selected={isSelected}

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

                <div
                  className={cn(
                    'flex h-full flex-col gap-2 rounded-card border border-cosmos-border',
                    'bg-cosmos-muted/8 p-4 transition-colors peer-checked:border-cosmos-copy',
                    'hover:bg-cosmos-muted/15 motion-reduce:transition-none sm:p-5',
                  )}
                >
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

                  <p
                    className={cn(
                      'mt-auto pt-1 text-xs font-medium break-keep sm:pt-2',
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

interface RoleSelectionScreenProps {
  readonly initialSelectedRole: RoleSelection | null;

  readonly rejection: ClosedStaffAccessRequestNotice | null;
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
