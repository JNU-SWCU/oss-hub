'use client';

import { useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api-client';
import {
  previewProgramDeadline,
  sendProgramDeadline,
  type ProgramDeadlineGuidance,
  type ProgramDeadlinePreview,
  type ProgramDeadlineSendResult,
} from './program-deadline-api';

export function useProgramDeadlinePreview(
  programId: string | undefined,
  enabled: boolean,
) {
  const [guidance, setGuidance] = useState<ProgramDeadlineGuidance>({
    studentGuidance: '',
    staffGuidance: '',
  });
  const [preview, setPreview] = useState<ProgramDeadlinePreview | null>(null);
  const [result, setResult] = useState<ProgramDeadlineSendResult | null>(null);
  const [busy, setBusy] = useState<'preview' | 'send' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const requestId = useRef(0);
  const invalidGuidance =
    guidance.studentGuidance.length > 4000 ||
    guidance.staffGuidance.length > 4000;

  useEffect(() => {
    requestId.current += 1;
    setPreview(null);
    setResult(null);
    setBusy(null);
    setError(null);
    return () => {
      requestId.current += 1;
    };
  }, [programId, enabled]);

  useEffect(() => {
    if (preview === null || busy === 'send') return;
    const remaining = new Date(preview.expiresAt).getTime() - Date.now();
    const timer = setTimeout(
      () => {
        setPreview(null);
        setNeedsRefresh(true);
        setError('미리보기가 만료되었습니다. 다시 미리보세요.');
      },
      Math.max(0, remaining),
    );
    return () => clearTimeout(timer);
  }, [preview, busy]);

  const changeGuidance = (
    audience: keyof ProgramDeadlineGuidance,
    value: string,
  ) => {
    requestId.current += 1;
    setGuidance((previous) => ({ ...previous, [audience]: value }));
    setNeedsRefresh(
      (previous) => previous || preview !== null || busy === 'preview',
    );
    setPreview(null);
    setResult(null);
    setError(null);
    setBusy(null);
  };

  const loadPreview = async () => {
    if (programId === undefined || !enabled || invalidGuidance) return;
    const current = ++requestId.current;
    setBusy('preview');
    setPreview(null);
    setError(null);
    setResult(null);
    try {
      const next = await previewProgramDeadline(programId, guidance);
      if (current !== requestId.current) return;
      setPreview(next);
      setNeedsRefresh(false);
    } catch (caught: unknown) {
      if (current !== requestId.current) return;
      setError(deadlineErrorMessage(caught));
    } finally {
      if (current === requestId.current) setBusy(null);
    }
  };

  const send = async () => {
    if (
      programId === undefined ||
      !enabled ||
      preview === null ||
      busy !== null ||
      invalidGuidance
    )
      return;
    if (new Date(preview.expiresAt).getTime() <= Date.now()) {
      setPreview(null);
      setNeedsRefresh(true);
      setError('미리보기가 만료되었습니다. 다시 미리보세요.');
      return;
    }
    const current = ++requestId.current;
    setBusy('send');
    setError(null);
    try {
      const sent = await sendProgramDeadline(programId, {
        previewedAt: preview.previewedAt,
        previewVersion: preview.previewVersion,
        ...guidance,
      });
      if (current !== requestId.current) return;
      setResult(sent);
      setPreview(null);
      setNeedsRefresh(true);
    } catch (caught: unknown) {
      if (current !== requestId.current) return;
      if (caught instanceof ApiError && caught.problem.status === 409) {
        setPreview(null);
        setNeedsRefresh(true);
      }
      setError(deadlineErrorMessage(caught));
    } finally {
      if (current === requestId.current) setBusy(null);
    }
  };

  return {
    guidance,
    preview,
    result,
    busy,
    error,
    needsRefresh,
    invalidGuidance,
    changeGuidance,
    loadPreview,
    send,
  };
}

function deadlineErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.problem.status === 409)
      return '발송 대상이 바뀌었거나 미리보기가 만료되었습니다. 다시 미리보세요.';
    if (error.problem.status === 400)
      return '안내 문구를 확인해 주세요. 각각 4,000자 이내의 평문으로 입력해 주세요.';
  }
  return '잠시 후 다시 시도해 주세요.';
}
