'use client';

import { useState, type FormEvent } from 'react';
import { BriefcaseBusiness, GraduationCap } from 'lucide-react';

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
}

const ROLE_OPTIONS: readonly RoleOption[] = [
  {
    role: 'STUDENT',
    title: '학생',
    description: '프로그램을 찾아보고 개인 또는 팀으로 지원합니다.',
  },
  {
    role: 'STAFF',
    title: '교직원',
    description: '프로그램을 만들고 지원자와 제출물을 관리합니다.',
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

  return (
    <StatusMessagePage
      title="역할을 선택해 주세요"
      description="선택한 역할에 맞는 화면과 기능을 안내합니다."
      action={
        <form
          className="flex w-full max-w-2xl flex-col gap-4 text-left"
          onSubmit={handleSubmit}
        >
          <fieldset className="grid gap-3 sm:grid-cols-2">
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
                      <div className="mb-2 flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <RoleIcon role={option.role} />
                      </div>
                      <CardTitle>{option.title}</CardTitle>
                      <CardDescription>{option.description}</CardDescription>
                    </CardHeader>
                    {option.role === 'STAFF' ? (
                      <CardContent>
                        <p className="text-xs font-medium text-status-pending-fg">
                          관리자 승인이 필요합니다
                        </p>
                      </CardContent>
                    ) : null}
                  </Card>
                </label>
              );
            })}
          </fieldset>

          {selectedRole === 'STAFF' ? (
            <Alert>
              <AlertTitle>승인 후 교직원 기능을 사용할 수 있습니다</AlertTitle>
              <AlertDescription>
                요청을 제출하면 승인 상태를 확인할 수 있는 화면으로 이동합니다.
              </AlertDescription>
            </Alert>
          ) : null}

          {errorMessage ? (
            <Alert variant="destructive">
              <AlertTitle>역할을 저장하지 못했습니다</AlertTitle>
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          ) : null}

          <Button
            type="submit"
            size="lg"
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
