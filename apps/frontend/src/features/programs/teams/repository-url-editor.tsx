'use client';

import { ExternalLink } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { GitHubMark } from '@/components/github-mark';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api-client';
import { formatSeoulDate } from '../catalog/program-detail-format';
import { RepositoryUrlCancelButton } from './repository-url-cancel-button';
import type { RepositoryUrlState } from './repository-url-dto';
import { repositoryNameFromUrl } from './repository-url-history';

const UNCONFIRMED_SAVE_MESSAGE =
  '저장 결과를 확인할 수 없습니다.\n입력은 유지되었습니다.\n다시 불러와 현재 상태를 확인한 뒤에만 저장하세요.';

const COLLECTION_AGE = new Intl.RelativeTimeFormat('ko-KR');

function recentCollectionAge(value: string): string | null {
  const minutes = Math.floor((Date.now() - Date.parse(value)) / 60_000);
  if (minutes < 0 || minutes >= 24 * 60) return null;
  if (minutes === 0) return '방금 전';
  return minutes < 60
    ? COLLECTION_AGE.format(-minutes, 'minute')
    : COLLECTION_AGE.format(-Math.floor(minutes / 60), 'hour');
}

export interface RepositoryUrlEditorProps {
  readonly repository: RepositoryUrlState;
  readonly defaultBranch?: string | null;
  readonly lastSuccessAt?: string | null;

  readonly save: (repositoryUrl: string) => Promise<RepositoryUrlState>;

  readonly reload: () => Promise<boolean>;

  readonly lockedHint?: string;

  readonly children?: ReactNode;
}

export function RepositoryUrlEditor({
  repository,
  defaultBranch,
  lastSuccessAt,
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
  const hintId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
    else if (wasEditing.current) editButtonRef.current?.focus();
    wasEditing.current = editing;
  }, [editing]);

  if (lastRead !== repository) {
    setLastRead(repository);
    setShown(repository);
    if (!repository.canEditRepositoryUrl) setEditing(false);
    if (needsVerification) {
      setNeedsVerification(false);
      setError(null);
    }
  }
  const editable = shown.canEditRepositoryUrl;
  const metadataIsCurrent = shown.repositoryUrl === repository.repositoryUrl;
  const branch = metadataIsCurrent ? defaultBranch?.trim() : null;
  const collectedAt = metadataIsCurrent ? lastSuccessAt : null;
  const collectedStamp = collectedAt ? formatSeoulDate(collectedAt) : undefined;

  async function submit() {
    if (!editable || busy || needsVerification) return;
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
      className={[
        'grid min-w-0 gap-4 rounded-card bg-card p-card text-card-foreground ring-1 ring-foreground/10',
        'break-keep [overflow-wrap:anywhere]',
      ].join(' ')}
      aria-label="프로젝트 저장소"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-sm font-semibold">프로젝트 저장소</h2>
        {!editing ? (
          <Button
            ref={editButtonRef}
            type="button"
            variant="outline"
            size="sm"
            disabled={!editable}
            aria-describedby={!editable && lockedHint ? hintId : undefined}
            onClick={() => {
              setUrl(shown.repositoryUrl ?? '');
              if (!needsVerification) setError(null);
              setSaved(false);
              setEditing(true);
            }}
          >
            변경
          </Button>
        ) : null}
      </div>
      {editing ? (
        <form
          className="grid min-w-0 gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Field>
            <FieldLabel htmlFor="repository-url">저장소 주소</FieldLabel>
            <Input
              ref={inputRef}
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
              aria-label={busy ? '저장 중…' : '저장소 주소 저장'}
              disabled={busy || needsVerification}
              aria-busy={busy}
            >
              {busy ? '저장 중…' : '저장'}
            </Button>
          </div>
        </form>
      ) : shown.repositoryUrl ? (
        <div className="grid min-w-0 gap-1">
          <a
            href={shown.repositoryUrl}
            target="_blank"
            rel="noreferrer noopener"
            className={[
              'inline-flex w-fit max-w-full items-center gap-2 text-body font-semibold text-primary',
              'underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
            ].join(' ')}
          >
            <GitHubMark className="size-5 shrink-0 text-muted-foreground" />
            <span className="min-w-0">
              {repositoryNameFromUrl(shown.repositoryUrl)}
            </span>
            <ExternalLink
              aria-hidden="true"
              className="size-4 shrink-0 text-muted-foreground"
            />
          </a>
          {branch || collectedAt ? (
            <p className="text-small text-muted-foreground">
              {branch ? `기본 브랜치 ${branch}` : null}
              {branch && collectedAt ? ' · ' : null}
              {collectedAt ? (
                <>
                  마지막 수집{' '}
                  <time dateTime={collectedAt} title={collectedStamp}>
                    {recentCollectionAge(collectedAt) ?? collectedStamp}
                  </time>
                </>
              ) : null}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          연결된 저장소가 없습니다.
        </p>
      )}
      {!editable && lockedHint ? (
        <p id={hintId} className="text-sm text-muted-foreground">
          {lockedHint}
        </p>
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
                    if (applied) {
                      setNeedsVerification(false);
                      setError(null);
                    }
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
