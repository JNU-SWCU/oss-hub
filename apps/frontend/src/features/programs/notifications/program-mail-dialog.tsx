'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { DialogShell, FailureState } from '@/components';
import { Skeleton, SkeletonBlock } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api-client';
import {
  getProgramMailRecipients,
  previewProgramMail,
  sendProgramMail,
} from './program-mail-api';
import type {
  ProgramMailPreview,
  ProgramMailSendResult,
} from './program-mail-dto';
import {
  ProgramMailCompose,
  ProgramMailPreviewView,
} from './program-mail-compose';

const SUBJECT_LIMIT = 200;
const BODY_LIMIT = 4000;

type Busy = 'preview' | 'send' | null;

export function ProgramMailDialog({
  programId,
  open,
  returnFocusRef,
  onClose,
}: {
  readonly programId: string;
  readonly open: boolean;
  readonly returnFocusRef: RefObject<HTMLButtonElement | null>;
  readonly onClose: () => void;
}) {
  const recipientsQuery = useQuery({
    queryKey: ['program-mail-recipients', programId],
    queryFn: () => getProgramMailRecipients(programId),
    enabled: open,
  });
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [preview, setPreview] = useState<ProgramMailPreview | null>(null);
  const [result, setResult] = useState<ProgramMailSendResult | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) return;
    setSelectedIds(new Set());
    setSubject('');
    setBody('');
    setPreview(null);
    setResult(null);
    setBusy(null);
    setError(null);
  }, [open]);

  useEffect(() => {
    if (preview === null || result !== null || busy !== null) return;
    queueMicrotask(() => editButtonRef.current?.focus());
  }, [busy, preview, result]);

  const canPreview =
    selectedIds.size > 0 &&
    subject.trim().length > 0 &&
    subject.length <= SUBJECT_LIMIT &&
    body.trim().length > 0 &&
    body.length <= BODY_LIMIT &&
    busy === null;

  const changeDraft = (change: () => void) => {
    change();
    setPreview(null);
    setResult(null);
    setError(null);
  };

  const loadPreview = async () => {
    if (!canPreview) return;
    setBusy('preview');
    setError(null);
    try {
      setPreview(
        await previewProgramMail(programId, {
          subject,
          body,
          applicantIds: [...selectedIds],
        }),
      );
    } catch (caught: unknown) {
      setError(apiErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  };

  const send = async () => {
    if (preview === null || busy !== null) return;
    setBusy('send');
    setError(null);
    try {
      setResult(await sendProgramMail(programId, preview));
    } catch (caught: unknown) {
      setPreview(null);
      setError(apiErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  };

  const footer = result ? (
    <Button type="button" onClick={onClose}>
      닫기
    </Button>
  ) : preview ? (
    <>
      <Button
        ref={editButtonRef}
        type="button"
        variant="outline"
        disabled={busy !== null}
        onClick={() => setPreview(null)}
      >
        수정
      </Button>
      <Button
        type="button"
        disabled={busy !== null}
        onClick={() => void send()}
      >
        {busy === 'send' ? '보내는 중…' : '보내기'}
      </Button>
    </>
  ) : (
    <>
      <Button
        type="button"
        variant="outline"
        disabled={busy !== null}
        onClick={onClose}
      >
        취소
      </Button>
      <Button
        type="button"
        disabled={!canPreview}
        onClick={() => void loadPreview()}
      >
        {busy === 'preview' ? '미리보는 중…' : '미리보기'}
      </Button>
    </>
  );

  return (
    <DialogShell
      open={open}
      title="메일 보내기"
      size="lg"
      busy={busy !== null}
      returnFocusRef={returnFocusRef}
      className="max-h-[calc(100dvh-2rem)]"
      bodyClassName="gap-6"
      onCancel={onClose}
      footer={footer}
    >
      {recipientsQuery.isPending ? (
        <Skeleton label="메일 수신자 불러오는 중" className="grid gap-4">
          <SkeletonBlock className="h-32 rounded-card" />
          <SkeletonBlock className="h-32 rounded-card" />
        </Skeleton>
      ) : recipientsQuery.isError ? (
        <FailureState
          title="메일 수신자를 불러오지 못했습니다"
          onRetry={() => void recipientsQuery.refetch()}
        />
      ) : result ? (
        <Alert>
          <AlertTitle>{result.sentCount}명에게 메일을 보냈습니다.</AlertTitle>
          <AlertDescription>
            중복 생략 {result.duplicateCount}명 · 발송 실패 {result.failedCount}
            명
          </AlertDescription>
        </Alert>
      ) : preview ? (
        <ProgramMailPreviewView preview={preview} />
      ) : (
        <ProgramMailCompose
          model={{
            recipients: recipientsQuery.data,
            selectedIds,
            subject,
            body,
          }}
          onChange={{
            selection: (next) => changeDraft(() => setSelectedIds(next)),
            subject: (next) => changeDraft(() => setSubject(next)),
            body: (next) => changeDraft(() => setBody(next)),
          }}
        />
      )}
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>메일을 처리하지 못했습니다</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </DialogShell>
  );
}

function apiErrorMessage(error: unknown): string {
  return error instanceof ApiError
    ? error.problem.detail
    : '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
}
