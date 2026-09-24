'use client';

import { Check, LoaderCircle, Pencil } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api-client';
import { RepositoryUrlCancelButton } from './repository-url-cancel-button';
import type { RepositoryUrlState } from './repository-url-api';

const UNCONFIRMED_SAVE_MESSAGE =
  '저장 결과를 확인할 수 없습니다.\n입력은 유지되었습니다.\n다시 불러와 현재 상태를 확인한 뒤에만 저장하세요.';

export interface RepositoryUrlEditorProps {
  /**
   * 화면이 마지막으로 읽은 서버 값 — 그래프와 같은 조회에서 온다. 새로 읽을 때마다
   * 새 객체가 오고, 그때 권한도 새 값을 따른다(팀장 교체·승인·종료일).
   */
  readonly repository: RepositoryUrlState;
  /** 저장 경로. 학생은 내 신청, 교직원은 팀 경로이며 응답 모양은 같다. */
  readonly save: (repositoryUrl: string) => Promise<RepositoryUrlState>;
  /** 서버 값을 다시 읽는다. 적용되면 `true`, 더 새 조회에 밀리면 `false`, 실패하면 던진다. */
  readonly reload: () => Promise<boolean>;
  /** 바꿀 수 없을 때 누가 언제 바꿀 수 있는지 말하는 한 줄. */
  readonly lockedHint?: string;
  /** URL 줄 아래에 붙는 화면 고유 내용(교직원의 발급·공개 상태). */
  readonly children?: ReactNode;
}

export function RepositoryUrlEditor({
  repository,
  save,
  reload,
  lockedHint,
  children,
}: RepositoryUrlEditorProps) {
  const [shown, setShown] = useState(repository);
  const [lastRead, setLastRead] = useState(repository);
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [needsVerification, setNeedsVerification] = useState(false);
  if (lastRead !== repository) {
    // 화면이 서버를 새로 읽었다. 권한이 닫혔으면 입력도 닫고, 확인하지 못한 저장은
    // 이제 확인된 것이다 — 이 값이 이 편집기가 아는 어떤 값보다 새롭다.
    setLastRead(repository);
    setShown(repository);
    if (!repository.canEditRepositoryUrl) setEditing(false);
    if (needsVerification) {
      setNeedsVerification(false);
      setError(null);
    }
  }
  const editable = shown.canEditRepositoryUrl;

  async function submit() {
    if (needsVerification) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      setShown(await save(url));
      setEditing(false);
      setSaved(true);
    } catch (failure: unknown) {
      if (failure instanceof ApiError) {
        setError(
          `${failure.problem.detail}\n입력은 유지되었습니다.\n재시도하세요.`,
        );
      } else {
        setNeedsVerification(true);
        setError(UNCONFIRMED_SAVE_MESSAGE);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="grid gap-3 rounded-card bg-card p-4 text-card-foreground ring-1 ring-foreground/10 break-keep [overflow-wrap:anywhere]"
      aria-label="프로젝트 저장소"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">프로젝트 저장소</h2>
        {!editing ? (
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="저장소 URL 수정"
            title="저장소 URL 수정"
            disabled={!editable}
            onClick={() => {
              setUrl(shown.repositoryUrl ?? '');
              if (!needsVerification) setError(null);
              setSaved(false);
              setEditing(true);
            }}
          >
            <Pencil aria-hidden="true" />
          </Button>
        ) : null}
      </div>
      {shown.repositoryUrl ? (
        <a
          href={shown.repositoryUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="break-all text-sm underline underline-offset-4"
        >
          {shown.repositoryUrl}
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
            void submit();
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
              dirty={url !== (shown.repositoryUrl ?? '')}
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
      {!editable && lockedHint ? (
        <p className="text-sm text-muted-foreground">{lockedHint}</p>
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
      {children}
    </section>
  );
}
