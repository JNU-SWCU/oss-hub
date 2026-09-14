'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api-client';
import { RepositoryUrlCancelButton } from './repository-url-cancel-button';
import {
  getRepositoryUrl,
  updateRepositoryUrl,
  type RepositoryUrlState,
} from './repository-url-api';

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error' }
  | { readonly kind: 'ready'; readonly repository: RepositoryUrlState };

export function RepositoryUrlEditor({
  programId,
}: {
  readonly programId: string;
}) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [validation, setValidation] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const reload = useCallback(async () => {
    const repository = await getRepositoryUrl(programId);
    setState({ kind: 'ready', repository });
  }, [programId]);
  useEffect(() => {
    let active = true;
    void getRepositoryUrl(programId).then(
      (repository) => {
        if (active) setState({ kind: 'ready', repository });
      },
      () => {
        if (active) setState({ kind: 'error' });
      },
    );
    return () => {
      active = false;
    };
  }, [programId]);

  async function save() {
    if (!reason.trim() || reason.trim().length > 500) {
      setValidation(true);
      reasonRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const repository = await updateRepositoryUrl(programId, {
        repositoryUrl: url,
        reason,
      });
      setState({ kind: 'ready', repository });
      setEditing(false);
      setReason('');
      setSaved(true);
      try {
        await reload();
      } catch {
        setError(
          '저장은 완료했지만 최신 상태를 불러오지 못했습니다. 다시 불러와 주세요.',
        );
      }
    } catch (failure: unknown) {
      setError(
        failure instanceof ApiError
          ? `${failure.problem.detail}\n입력은 유지되었습니다.\n재시도하세요.`
          : '저장하지 못했습니다.\n입력은 유지되었습니다.\n재시도하세요.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="mt-6 grid gap-4 rounded-card border border-border p-card break-keep [overflow-wrap:anywhere]"
      aria-label="프로젝트 저장소"
    >
      <h2 className="rounded-control bg-primary px-4 py-3 font-semibold text-primary-foreground">
        프로젝트 저장소
      </h2>
      {state.kind === 'loading' ? (
        <p role="status">저장소를 불러오는 중…</p>
      ) : null}
      {state.kind === 'error' ? (
        <Alert variant="destructive">
          <AlertTitle>저장소 조회 실패</AlertTitle>
          <AlertDescription>
            <Button
              onClick={() =>
                void reload().catch(() => setState({ kind: 'error' }))
              }
            >
              다시 불러오기
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {state.kind === 'ready' ? (
        <>
          {state.repository.repositoryUrl ? (
            <a
              href={state.repository.repositoryUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="break-all text-sm underline underline-offset-4"
            >
              {state.repository.repositoryUrl}
            </a>
          ) : (
            <p className="text-sm text-muted-foreground">
              연결된 저장소가 없습니다.
            </p>
          )}
          {editing ? (
            <form
              className="grid gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              <Alert>
                <AlertTitle>저장소 변경 안내</AlertTitle>
                <AlertDescription className="break-keep [overflow-wrap:anywhere]">
                  연결된 저장소와 활동 수집 대상이 바뀝니다. 변경{' '}
                  <span className="whitespace-nowrap">전·후</span> 주소와 변경
                  사유는 교직원이 확인할 수 있습니다.
                </AlertDescription>
              </Alert>
              {validation ? (
                <p role="alert" className="text-sm text-destructive">
                  변경 사유를 1~500자로 입력해 주세요.
                </p>
              ) : null}
              <Field>
                <FieldLabel htmlFor="repository-url">새 저장소 URL</FieldLabel>
                <Input
                  id="repository-url"
                  type="url"
                  required
                  value={url}
                  disabled={busy}
                  onChange={(event) => setUrl(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="repository-url-reason">
                  변경 사유 (필수)
                </FieldLabel>
                <textarea
                  ref={reasonRef}
                  id="repository-url-reason"
                  className="min-h-24 rounded-control border border-input p-3 text-sm"
                  value={reason}
                  disabled={busy}
                  maxLength={500}
                  aria-invalid={validation}
                  onChange={(event) => {
                    setReason(event.target.value);
                    setValidation(false);
                  }}
                />
                {validation ? (
                  <FieldError>
                    공백을 제외한 변경 사유를 입력해 주세요.
                  </FieldError>
                ) : null}
              </Field>
              <div className="flex justify-end gap-2">
                <RepositoryUrlCancelButton
                  dirty={
                    url !== (state.repository.repositoryUrl ?? '') ||
                    reason !== ''
                  }
                  disabled={busy}
                  onDiscard={() => {
                    setEditing(false);
                    setError(null);
                  }}
                />
                <Button type="submit" disabled={busy} aria-busy={busy}>
                  {busy ? '저장 중…' : '저장소 변경 저장'}
                </Button>
              </div>
            </form>
          ) : (
            <div className="flex justify-end">
              <Button
                disabled={!state.repository.canEditRepositoryUrl}
                onClick={() => {
                  setUrl(state.repository.repositoryUrl ?? '');
                  setReason('');
                  setValidation(false);
                  setError(null);
                  setSaved(false);
                  setEditing(true);
                }}
              >
                저장소 URL 수정
              </Button>
            </div>
          )}
          {!state.repository.canEditRepositoryUrl ? (
            <p className="text-sm text-muted-foreground">
              승인된 신청의 신청자 또는 팀장만 프로그램 종료 전까지 변경할 수
              있습니다.
            </p>
          ) : null}
        </>
      ) : null}
      {saved ? (
        <p role="status" className="text-sm">
          저장소 변경을 저장했습니다.
        </p>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>저장소 상태 확인</AlertTitle>
          <AlertDescription className="grid justify-items-start gap-2 break-keep text-wrap md:text-wrap">
            <p className="whitespace-pre-line">{error}</p>
            <Button
              variant="link"
              onClick={() =>
                void reload()
                  .then(() => setError(null))
                  .catch(() =>
                    setError('다시 불러오지 못했습니다. 잠시 후 재시도하세요.'),
                  )
              }
            >
              다시 불러오기
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
    </section>
  );
}
