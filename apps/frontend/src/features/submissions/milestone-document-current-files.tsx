'use client';

import { Download } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api-client';
import {
  downloadMilestoneDocumentCurrentFile,
  listMilestoneDocumentCurrentFiles,
} from './api';
import type { MilestoneDocumentCurrentFileItem } from './types';

type CurrentFilesState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed'; readonly message: string }
  | {
      readonly kind: 'ready';
      readonly files: readonly MilestoneDocumentCurrentFileItem[];
    };

export function MilestoneDocumentCurrentFiles({
  milestoneId,
}: {
  readonly milestoneId: string;
}) {
  const [state, setState] = useState<CurrentFilesState>({ kind: 'loading' });
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const documents = await listMilestoneDocumentCurrentFiles(milestoneId);
      setState({
        kind: 'ready',
        files: documents.filter(
          (document) =>
            document.submissionType === 'FILE' &&
            document.viewerSubmission?.submitted === true,
        ),
      });
    } catch (error: unknown) {
      setState({
        kind: 'failed',
        message:
          error instanceof ApiError
            ? error.problem.detail
            : '현재 제출 파일을 불러오지 못했습니다.',
      });
    }
  }, [milestoneId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function download(document: MilestoneDocumentCurrentFileItem) {
    setDownloadingId(document.id);
    setDownloadError(null);
    try {
      const file = await downloadMilestoneDocumentCurrentFile(
        milestoneId,
        document.id,
      );
      const objectUrl = URL.createObjectURL(file.blob);
      const link = window.document.createElement('a');
      link.href = objectUrl;
      link.download = file.fileName;
      link.click();
      URL.revokeObjectURL(objectUrl);
    } catch (error: unknown) {
      setDownloadError(
        error instanceof ApiError
          ? error.problem.detail
          : '현재 제출 파일을 내려받지 못했습니다.',
      );
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <section
      className="grid gap-3 border-t border-border pt-4"
      aria-label="마일스톤 서류 현재 제출 파일"
      data-testid="milestone-document-current-files"
    >
      {state.kind === 'loading' ? (
        <p role="status" className="text-small text-muted-foreground">
          현재 제출 파일 확인 중…
        </p>
      ) : null}
      {state.kind === 'failed' ? (
        <Alert variant="destructive">
          <AlertDescription className="grid gap-3">
            <p>{state.message}</p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="w-fit"
              onClick={() => void load()}
            >
              다시 시도
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {state.kind === 'ready' && state.files.length > 0 ? (
        <>
          <h3 className="text-small font-semibold text-muted-foreground">
            현재 제출 파일
          </h3>
          <ul className="grid gap-2">
            {state.files.map((document) => {
              const busy = downloadingId === document.id;
              return (
                <li
                  key={document.id}
                  className="flex flex-wrap items-center justify-between gap-2"
                >
                  <span className="min-w-0 text-small font-medium break-keep">
                    {document.name}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={downloadingId !== null}
                    aria-busy={busy}
                    aria-label={`${document.name} 현재 제출 파일 내려받기`}
                    onClick={() => void download(document)}
                  >
                    <Download aria-hidden />
                    {busy ? '내려받는 중…' : '내려받기'}
                  </Button>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
      {downloadingId !== null ? (
        <p role="status" aria-live="polite" className="text-small">
          {state.kind === 'ready'
            ? `${state.files.find((file) => file.id === downloadingId)?.name ?? '파일'} 내려받는 중…`
            : '파일 내려받는 중…'}
        </p>
      ) : null}
      {downloadError ? (
        <Alert variant="destructive">
          <AlertDescription>{downloadError}</AlertDescription>
        </Alert>
      ) : null}
    </section>
  );
}
