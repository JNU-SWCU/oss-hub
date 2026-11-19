'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';
import {
  MailDialogErrorNotice,
  PREVIEW_EXPIRED,
  type MailDialogError,
} from './mail-dialog-error';
import { Skeleton, SkeletonBlock } from '@/components/ui/skeleton';
import { DialogShell } from '@/components';
import {
  previewProgramDeadline,
  sendProgramDeadline,
} from './program-deadline-api';
import type {
  ProgramDeadlineGuidance,
  ProgramDeadlinePreview,
  ProgramDeadlineSendResult,
} from './program-deadline-dto';
import {
  DEADLINE_GUIDANCE_LIMIT,
  DeadlineDigestFooter,
  DeadlineDigestPreview,
  DeadlineDigestResult,
  DeadlineGuidanceFields,
  deadlineErrorMessage,
  isDeadlineGuidanceInvalid,
  type DeadlineDigestBusy,
} from './deadline-digest-content';
import { usePreviewExpiry } from './use-preview-expiry';

export function DeadlineDigestDialog({
  programId,
  returnFocusRef,
  onClose,
}: {
  readonly programId: string;
  readonly returnFocusRef: RefObject<HTMLButtonElement | null>;
  readonly onClose: () => void;
}) {
  const [guidance, setGuidance] = useState<ProgramDeadlineGuidance>({
    studentGuidance: '',
    staffGuidance: '',
  });
  const [loaded, setLoaded] = useState<{
    readonly preview: ProgramDeadlinePreview;
    readonly guidance: ProgramDeadlineGuidance;
    readonly version: number;
  } | null>(null);
  const [result, setResult] = useState<ProgramDeadlineSendResult | null>(null);
  const [busy, setBusy] = useState<DeadlineDigestBusy>(null);
  const [error, setError] = useState<MailDialogError>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const studentGuidanceRef = useRef<HTMLTextAreaElement>(null);
  const guidanceRef = useRef(guidance);
  const focusGuidanceOnRender = useRef(false);
  const previewRequestVersion = useRef(0);
  const previewInFlight = useRef(false);
  const sendInFlight = useRef(false);
  const preview = loaded?.preview ?? null;

  const invalidGuidance = isDeadlineGuidanceInvalid(guidance);

  const loadPreview = useCallback(async () => {
    const draft = guidanceRef.current;
    if (
      draft.studentGuidance.length > DEADLINE_GUIDANCE_LIMIT ||
      draft.staffGuidance.length > DEADLINE_GUIDANCE_LIMIT ||
      previewInFlight.current ||
      sendInFlight.current
    )
      return;
    const requestVersion = ++previewRequestVersion.current;
    previewInFlight.current = true;
    setBusy('preview');
    setError(null);
    try {
      const loadedPreview = await previewProgramDeadline(programId, draft);
      if (requestVersion !== previewRequestVersion.current) return;
      setLoaded({
        preview: loadedPreview,
        guidance: draft,
        version: requestVersion,
      });
      setResult(null);
    } catch (caught: unknown) {
      if (requestVersion !== previewRequestVersion.current) return;
      setError(deadlineErrorMessage(caught));
    } finally {
      if (requestVersion === previewRequestVersion.current) {
        previewInFlight.current = false;
        setBusy(null);
      }
    }
  }, [programId]);

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

  useEffect(() => {
    if (preview !== null || !focusGuidanceOnRender.current) return;
    focusGuidanceOnRender.current = false;
    queueMicrotask(() => studentGuidanceRef.current?.focus());
  }, [preview]);

  const expirePreview = useCallback(() => {
    focusGuidanceOnRender.current = true;
    setLoaded(null);
    setError(PREVIEW_EXPIRED);
  }, []);
  const expireIfDue = usePreviewExpiry(
    busy === null ? preview?.expiresAt : undefined,
    expirePreview,
  );

  const changeGuidance = (
    field: keyof ProgramDeadlineGuidance,
    value: string,
  ) => {
    previewRequestVersion.current += 1;
    previewInFlight.current = false;
    guidanceRef.current = { ...guidanceRef.current, [field]: value };
    setGuidance(guidanceRef.current);
    setLoaded(null);
    setResult(null);
    setBusy((current) => (current === 'preview' ? null : current));
    setError(null);
  };

  const edit = () => {
    focusGuidanceOnRender.current = true;
    previewRequestVersion.current += 1;
    setLoaded(null);
    setError(null);
  };

  const send = async () => {
    if (
      preview === null ||
      loaded?.version !== previewRequestVersion.current ||
      busy !== null ||
      sendInFlight.current ||
      expireIfDue()
    )
      return;
    sendInFlight.current = true;
    setBusy('send');
    setError(null);
    try {
      const sent = await sendProgramDeadline(programId, {
        previewedAt: preview.previewedAt,
        previewVersion: preview.previewVersion,
        ...loaded.guidance,
      });
      setResult(sent);
      setLoaded(null);
    } catch (caught: unknown) {
      setLoaded(null);
      setError(deadlineErrorMessage(caught));
    } finally {
      sendInFlight.current = false;
      setBusy(null);
    }
  };

  const footer = (
    <DeadlineDigestFooter
      model={{ result, preview, busy, invalidGuidance }}
      editButtonRef={editButtonRef}
      actions={{
        close: onClose,
        edit,
        preview: () => void loadPreview(),
        send: () => void send(),
      }}
    />
  );

  return (
    <DialogShell
      title="마감 알림 보내기"
      size="lg"
      busy={busy !== null}
      returnFocusRef={returnFocusRef}
      className="max-h-[calc(100dvh-2rem)]"
      bodyClassName="gap-6"
      onCancel={onClose}
      footer={footer}
    >
      {busy === 'preview' && preview === null ? (
        <Skeleton label="마감 알림 미리보는 중" className="grid gap-4">
          <SkeletonBlock className="h-36 rounded-card" />
          <SkeletonBlock className="h-80 rounded-card" />
        </Skeleton>
      ) : result ? (
        <DeadlineDigestResult result={result} />
      ) : preview ? (
        <DeadlineDigestPreview preview={preview} />
      ) : (
        <DeadlineGuidanceFields
          guidance={guidance}
          studentGuidanceRef={studentGuidanceRef}
          disabled={busy !== null}
          onChange={changeGuidance}
        />
      )}
      <MailDialogErrorNotice
        error={error}
        title="마감 알림을 처리하지 못했습니다"
      />
    </DialogShell>
  );
}
