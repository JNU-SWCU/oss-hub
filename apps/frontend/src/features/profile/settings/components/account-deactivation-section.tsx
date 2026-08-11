'use client';

import { useState } from 'react';
import { AlertDialog } from 'radix-ui';
import { FormSection } from '@/components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ProfileRole } from '../../profile-requirements';
import {
  classifyAccountDeactivationError,
  deactivateMyAccount,
} from '../account-deactivation-api';

function errorMessage(error: unknown): string {
  switch (classifyAccountDeactivationError(error)) {
    case 'unauthorized':
      return '로그인 상태가 만료되었습니다. 페이지를 새로 열어 다시 확인해 주세요.';
    case 'last-active-admin':
      return '마지막 활성 관리자는 계정을 비활성화할 수 없습니다. 다른 관리자를 먼저 지정해 주세요.';
    case 'generic':
      return '계정을 비활성화하지 못했습니다. 잠시 후 다시 시도해 주세요.';
  }
}

export function AccountDeactivationSection({
  role,
  onDeactivated = () => window.location.assign('/account-deactivated'),
}: {
  readonly role: ProfileRole | null;
  /** 테스트와 앱 경계를 위한 완료 이동. 기본값은 비활성화 완료 전용 화면이다. */
  readonly onDeactivated?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmDeactivation(): Promise<void> {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await deactivateMyAccount();
      onDeactivated();
    } catch (reason: unknown) {
      setError(errorMessage(reason));
      setSubmitting(false);
    }
  }

  return (
    <FormSection
      title="계정 관리"
      description={
        <span className="[word-break:keep-all]">
          서비스 접근을 중지하되, 제출물과{' '}
          <span className="whitespace-nowrap">동의·활동 이력은</span> 삭제되지
          않습니다.
        </span>
      }
    >
      <div className="space-y-4">
        <p className="text-sm leading-6 text-muted-foreground [word-break:keep-all]">
          비활성화하면 즉시 로그아웃되며 재로그인이 차단됩니다. 다시 사용하려면
          관리자에게 재활성화를 요청해야 합니다.
          {role === 'ADMIN'
            ? ' 마지막 활성 관리자는 서비스 운영 보호를 위해 비활성화할 수 없습니다.'
            : ''}
        </p>

        <AlertDialog.Root
          open={open}
          onOpenChange={(nextOpen) => {
            if (!submitting) {
              setOpen(nextOpen);
              if (!nextOpen) setError(null);
            }
          }}
        >
          <AlertDialog.Trigger asChild>
            <Button type="button" variant="destructive">
              계정 비활성화
            </Button>
          </AlertDialog.Trigger>
          <AlertDialog.Overlay className="fixed inset-0 z-50 bg-foreground/35" />
          <AlertDialog.Content className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 outline-none">
            <Card className="max-h-[calc(100svh-2rem)] overflow-y-auto shadow-xl">
              <CardHeader>
                <AlertDialog.Title asChild>
                  <CardTitle className="[word-break:keep-all]">
                    계정을 비활성화하시겠습니까?
                  </CardTitle>
                </AlertDialog.Title>
              </CardHeader>
              <CardContent className="space-y-5">
                <AlertDialog.Description className="text-sm leading-6 text-muted-foreground [word-break:keep-all]">
                  확인하면 이 서비스에서 즉시 로그아웃되고 접근이 차단됩니다.
                  제출물과 동의·활동 이력은 삭제되지 않습니다. 다시 사용하려면
                  관리자에게 재활성화를 요청해야 합니다.
                </AlertDialog.Description>
                {error ? (
                  <Alert variant="destructive">
                    <AlertTitle>계정을 비활성화하지 못했습니다</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                ) : null}
                <div className="flex flex-wrap justify-end gap-2">
                  <AlertDialog.Cancel asChild>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={submitting}
                    >
                      돌아가기
                    </Button>
                  </AlertDialog.Cancel>
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={submitting}
                    onClick={() => void confirmDeactivation()}
                  >
                    {submitting ? '비활성화 중…' : '비활성화하고 로그아웃'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </AlertDialog.Content>
        </AlertDialog.Root>
      </div>
    </FormSection>
  );
}
