'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AlertDialog } from 'radix-ui';
import { SectionHeading } from '@/components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { deleteProgram } from './api';
import {
  mapProgramDeleteError,
  type ProgramDeleteError,
} from './program-edit-delete-flow';

interface ProgramEditDangerZoneSectionProps {
  readonly programId: string;
  readonly programName: string;
  /** ADMIN이 아니면 이 섹션은 아무것도 그리지 않는다(#875 — STAFF에게는 버튼조차 없다). */
  readonly isAdmin: boolean;
  /** 삭제 성공 후 이동. 기본값은 프로그램 목록이다. */
  readonly onDeleted?: () => void;
}

/**
 * 「위험 영역」— 프로그램 영구 삭제. 「게시 상태」 아래, 페이지 맨 끝에 둔다(#875).
 * 신청·팀·제출물·게시글이 하나라도 남아 있으면 백엔드가 409로 막고, 이 화면은
 * 그 이유를 카테고리별로 다른 문구로 보여준다(`program-edit-delete-flow`).
 */
export function ProgramEditDangerZoneSection({
  programId,
  programName,
  isAdmin,
  onDeleted = () => window.location.assign('/programs'),
}: ProgramEditDangerZoneSectionProps) {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ProgramDeleteError | null>(null);

  if (!isAdmin) return null;

  const canConfirm = confirmText === programName && !busy;

  const requestOpen = () => {
    setOpen(true);
    setConfirmText('');
    setError(null);
  };
  const cancel = () => {
    setOpen(false);
    setConfirmText('');
    setError(null);
  };
  const confirm = async () => {
    if (!canConfirm) return;
    setBusy(true);
    setError(null);
    try {
      await deleteProgram(programId);
      onDeleted();
    } catch (reason: unknown) {
      setError(mapProgramDeleteError(reason, programId));
      setBusy(false);
    }
  };

  return (
    <section className="grid gap-6">
      <SectionHeading title="위험 영역" />
      <p className="text-body text-muted-foreground [word-break:keep-all]">
        프로그램을 영구히 삭제합니다. 신청·팀·제출물·게시글이 하나라도 남아
        있으면 삭제할 수 없습니다.
      </p>
      <div className="flex justify-end">
        <Button type="button" variant="destructive" onClick={requestOpen}>
          삭제
        </Button>
      </div>
      {open ? (
        <AlertDialog.Root
          open
          onOpenChange={(next) => !next && !busy && cancel()}
        >
          <AlertDialog.Portal>
            <AlertDialog.Overlay className="fixed inset-0 z-50 bg-foreground/35" />
            <AlertDialog.Content className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 outline-none">
              <Card className="shadow-xl">
                <CardHeader>
                  <AlertDialog.Title asChild>
                    <CardTitle>프로그램을 영구히 삭제할까요?</CardTitle>
                  </AlertDialog.Title>
                </CardHeader>
                <CardContent className="grid gap-5">
                  <AlertDialog.Description className="text-body text-muted-foreground [word-break:keep-all]">
                    되돌릴 수 없습니다. 계속하려면 프로그램 이름{' '}
                    <span className="font-semibold text-foreground">
                      {programName}
                    </span>
                    을(를) 아래에 그대로 입력해 주세요.
                  </AlertDialog.Description>
                  <Field>
                    <FieldLabel htmlFor="program-delete-confirm-name">
                      프로그램 이름
                    </FieldLabel>
                    <Input
                      id="program-delete-confirm-name"
                      value={confirmText}
                      disabled={busy}
                      autoComplete="off"
                      onChange={(event) => setConfirmText(event.target.value)}
                    />
                  </Field>
                  {error ? <DeleteErrorAlert error={error} /> : null}
                  <div className="flex flex-wrap justify-end gap-2">
                    <AlertDialog.Cancel asChild>
                      <Button type="button" variant="outline" disabled={busy}>
                        취소
                      </Button>
                    </AlertDialog.Cancel>
                    <Button
                      type="button"
                      variant="destructive"
                      disabled={!canConfirm}
                      onClick={() => void confirm()}
                    >
                      {busy ? '삭제하는 중…' : '삭제'}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </AlertDialog.Content>
          </AlertDialog.Portal>
        </AlertDialog.Root>
      ) : null}
    </section>
  );
}

function DeleteErrorAlert({ error }: { readonly error: ProgramDeleteError }) {
  if (error.kind === 'generic') {
    return (
      <Alert variant="destructive">
        <AlertTitle>삭제 실패</AlertTitle>
        <AlertDescription>{error.message}</AlertDescription>
      </Alert>
    );
  }
  return (
    <Alert variant="destructive">
      <AlertTitle>삭제할 수 없습니다</AlertTitle>
      <AlertDescription>
        <ul className="grid gap-1">
          {error.messages.map((message) => (
            <li key={message.text}>
              {message.text}
              {message.boardHref ? (
                <>
                  {' '}
                  <Link href={message.boardHref} className="underline">
                    게시판으로 이동
                  </Link>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}
