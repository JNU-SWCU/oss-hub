'use client';

import { Check, LoaderCircle, Pencil } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
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

const UNCONFIRMED_SAVE_MESSAGE =
  '저장 결과를 확인할 수 없습니다.\n입력은 유지되었습니다.\n다시 불러와 현재 상태를 확인한 뒤에만 저장하세요.';

export function RepositoryUrlEditor({
  programId,
}: {
  readonly programId: string;
}) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [boundProgramId, setBoundProgramId] = useState(programId);
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [needsVerification, setNeedsVerification] = useState(false);
  const requestIdRef = useRef(0);
  if (boundProgramId !== programId) {
    setBoundProgramId(programId);
    setState({ kind: 'loading' });
    setEditing(false);
    setUrl('');
    setBusy(false);
    setError(null);
    setSaved(false);
    setNeedsVerification(false);
    requestIdRef.current += 1;
  }
  const reload = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    try {
      const repository = await getRepositoryUrl(programId);
      if (requestIdRef.current !== requestId) return false;
      setState({ kind: 'ready', repository });
      setNeedsVerification(false);
      return true;
    } catch (failure: unknown) {
      if (requestIdRef.current !== requestId) return false;
      throw failure;
    }
  }, [programId]);
  useEffect(() => {
    const requestId = ++requestIdRef.current;
    void getRepositoryUrl(programId).then(
      (repository) => {
        if (requestIdRef.current !== requestId) return;
        setState({ kind: 'ready', repository });
      },
      () => {
        if (requestIdRef.current !== requestId) return;
        setState({ kind: 'error' });
      },
    );
  }, [programId]);

  async function save() {
    if (needsVerification) return;
    const requestId = ++requestIdRef.current;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const repository = await updateRepositoryUrl(programId, {
        repositoryUrl: url,
      });
      if (requestIdRef.current !== requestId) return;
      setState({ kind: 'ready', repository });
      setEditing(false);
      setSaved(true);
    } catch (failure: unknown) {
      if (requestIdRef.current !== requestId) return;
      if (failure instanceof ApiError) {
        setError(
          `${failure.problem.detail}\n입력은 유지되었습니다.\n재시도하세요.`,
        );
      } else {
        setNeedsVerification(true);
        setError(UNCONFIRMED_SAVE_MESSAGE);
      }
    } finally {
      if (requestIdRef.current === requestId) setBusy(false);
    }
  }

  return (
    <section
      className="grid gap-3 rounded-card bg-card p-4 text-card-foreground ring-1 ring-foreground/10 break-keep [overflow-wrap:anywhere]"
      aria-label="프로젝트 저장소"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">프로젝트 저장소</h2>
        {state.kind === 'ready' && !editing ? (
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="저장소 URL 수정"
            title="저장소 URL 수정"
            disabled={!state.repository.canEditRepositoryUrl}
            onClick={() => {
              setUrl(state.repository.repositoryUrl ?? '');
              if (!needsVerification) setError(null);
              setSaved(false);
              setEditing(true);
            }}
          >
            <Pencil aria-hidden="true" />
          </Button>
        ) : null}
      </div>
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
              <div className="flex justify-end gap-2">
                <RepositoryUrlCancelButton
                  dirty={url !== (state.repository.repositoryUrl ?? '')}
                  disabled={busy}
                  onDiscard={() => {
                    setEditing(false);
                    if (!needsVerification) setError(null);
                  }}
                />
                <Button
                  type="submit"
                  size="icon-sm"
                  aria-label={busy ? '저장 중…' : '저장소 변경 저장'}
                  title="저장소 변경 저장"
                  disabled={busy || needsVerification}
                  aria-busy={busy}
                >
                  {busy ? (
                    <LoaderCircle className="animate-spin" aria-hidden="true" />
                  ) : (
                    <Check aria-hidden="true" />
                  )}
                </Button>
              </div>
            </form>
          ) : null}
          {!state.repository.canEditRepositoryUrl ? (
            <p className="text-sm text-muted-foreground">
              승인된 팀의 팀장만 프로그램 종료 전까지 변경할 수 있습니다.
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
                  .then((applied) => {
                    if (applied) setError(null);
                  })
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
