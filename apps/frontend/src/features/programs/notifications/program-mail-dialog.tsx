'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { DialogShell, FailureState } from '@/components';
import { Skeleton, SkeletonBlock } from '@/components/ui/skeleton';
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
import {
  canSendProgramMail,
  EMPTY_PROGRAM_MAIL_DRAFT,
  isProgramMailDraftReady,
  programMailErrorMessage,
  type ProgramMailDialogBusy,
  type ProgramMailDialogDraft,
} from './program-mail-dialog-state';

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
  const [draft, setDraft] = useState(EMPTY_PROGRAM_MAIL_DRAFT);
  const [loaded, setLoaded] = useState<{
    readonly preview: ProgramMailPreview;
    readonly version: number;
  } | null>(null);
  const [result, setResult] = useState<ProgramMailSendResult | null>(null);
  const [busy, setBusy] = useState<ProgramMailDialogBusy>(null);
  const [error, setError] = useState<string | null>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const draftRef = useRef(EMPTY_PROGRAM_MAIL_DRAFT);
  const previewRequestVersion = useRef(0);
  const previewInFlight = useRef(false);
  const sendInFlight = useRef(false);
  const preview = loaded?.preview ?? null;
  const recipientLimit = recipientsQuery.data?.recipientLimit;
  const canSend = canSendProgramMail(preview, recipientLimit, busy);

  useEffect(() => {
    if (open) return;
    previewRequestVersion.current += 1;
    previewInFlight.current = false;
    sendInFlight.current = false;
    draftRef.current = EMPTY_PROGRAM_MAIL_DRAFT;
    setDraft(EMPTY_PROGRAM_MAIL_DRAFT);
    setLoaded(null);
    setResult(null);
    setBusy(null);
    setError(null);
  }, [open]);

  useEffect(
    () => () => {
      previewRequestVersion.current += 1;
      previewInFlight.current = false;
      sendInFlight.current = false;
    },
    [],
  );

  useEffect(() => {
    if (preview === null || result !== null || busy !== null) return;
    queueMicrotask(() => editButtonRef.current?.focus());
  }, [busy, preview, result]);

  const canPreview =
    busy === null && isProgramMailDraftReady(draft, recipientLimit);

  const changeDraft = (change: Partial<ProgramMailDialogDraft>) => {
    previewRequestVersion.current += 1;
    previewInFlight.current = false;
    draftRef.current = { ...draftRef.current, ...change };
    setDraft(draftRef.current);
    setLoaded(null);
    setResult(null);
    setBusy((current) => (current === 'preview' ? null : current));
    setError(null);
  };

  const loadPreview = async () => {
    const current = draftRef.current;
    if (
      !isProgramMailDraftReady(current, recipientLimit) ||
      previewInFlight.current ||
      sendInFlight.current
    )
      return;
    const requestVersion = ++previewRequestVersion.current;
    previewInFlight.current = true;
    setBusy('preview');
    setError(null);
    try {
      const loadedPreview = await previewProgramMail(programId, {
        subject: current.subject,
        body: current.body,
        applicantIds: [...current.selectedIds],
      });
      if (requestVersion !== previewRequestVersion.current) return;
      setLoaded({ preview: loadedPreview, version: requestVersion });
    } catch (caught: unknown) {
      if (requestVersion !== previewRequestVersion.current) return;
      setError(programMailErrorMessage(caught));
    } finally {
      if (requestVersion === previewRequestVersion.current) {
        previewInFlight.current = false;
        setBusy(null);
      }
    }
  };

  const send = async () => {
    if (
      !canSend ||
      loaded?.version !== previewRequestVersion.current ||
      sendInFlight.current
    )
      return;
    sendInFlight.current = true;
    setBusy('send');
    setError(null);
    try {
      setResult(await sendProgramMail(programId, loaded.preview));
    } catch (caught: unknown) {
      setLoaded(null);
      setError(programMailErrorMessage(caught));
    } finally {
      sendInFlight.current = false;
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
        onClick={() => changeDraft({})}
      >
        수정
      </Button>
      <Button type="button" disabled={!canSend} onClick={() => void send()}>
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
          <AlertTitle>
            {result.status === 'IN_PROGRESS'
              ? '메일 발송을 처리 중입니다.'
              : `${result.sentCount}명에게 메일을 보냈습니다.`}
          </AlertTitle>
          {result.status === 'COMPLETED' ? (
            <AlertDescription>
              중복 생략 {result.duplicateCount}명 · 발송 실패{' '}
              {result.failedCount}명 · 발송 결과 확인 불가{' '}
              {result.unknownCount ?? 0}명
            </AlertDescription>
          ) : null}
        </Alert>
      ) : preview ? (
        <ProgramMailPreviewView preview={preview} />
      ) : (
        <ProgramMailCompose
          model={{
            recipients: recipientsQuery.data,
            ...draft,
          }}
          selectionRejected={draft.selectionRejected}
          onChange={{
            selection: (selectedIds) =>
              recipientLimit !== undefined && selectedIds.size <= recipientLimit
                ? changeDraft({ selectedIds, selectionRejected: false })
                : changeDraft({ selectionRejected: true }),
            subject: (subject) => changeDraft({ subject }),
            body: (body) => changeDraft({ body }),
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
