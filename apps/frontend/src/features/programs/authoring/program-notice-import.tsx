'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DialogShell } from '@/components';
import { ProgramNoticeSteps } from './program-notice-steps';
import { listProgramNotices, previewProgramNotice } from './program-notice-api';
import type {
  ProgramNoticePatch,
  ProgramNoticePreview,
} from './program-notice-dto';
import { ProgramNoticeCards } from './program-notice-cards';
import { ProgramNoticeReview } from './program-notice-review';
import {
  noticeReviewRows,
  type NoticeCurrent,
} from './program-notice-review-model';

type PreviewState =
  | { readonly kind: 'select' }
  | { readonly kind: 'loading'; readonly url: string }
  | { readonly kind: 'failed'; readonly url: string }
  | { readonly kind: 'ready'; readonly preview: ProgramNoticePreview };

export function ProgramNoticeImport(
  props: NoticeCurrent & {
    readonly hasCover: boolean;
    readonly sourceUrl?: string;
    readonly disabled?: boolean;
    readonly onApply: (patch: ProgramNoticePatch) => void;
  },
) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const request = useRef<AbortController | null>(null);
  const applied = useRef(false);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<PreviewState>({ kind: 'select' });
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [cover, setCover] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const notices = useQuery({
    queryKey: ['program-notice-list'],
    queryFn: ({ signal }) => listProgramNotices(signal),
    enabled: open,
    retry: false,
    staleTime: 0,
  });
  useEffect(() => () => request.current?.abort(), []);

  const reset = () => {
    request.current?.abort();
    request.current = null;
    setState({ kind: 'select' });
    setChecked(new Set());
    setCover(null);
  };
  const close = () => {
    reset();
    setOpen(false);
  };
  const pick = async (url: string) => {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setState({ kind: 'loading', url });
    try {
      const preview = await previewProgramNotice(url, controller.signal);
      if (controller.signal.aborted || request.current !== controller) return;
      setChecked(
        new Set(
          noticeReviewRows(preview, props)
            .filter((row) => row.next && row.current.trim() !== row.next.trim())
            .map((row) => row.key),
        ),
      );
      setCover(preview.coverImages[0] ?? null);
      setState({ kind: 'ready', preview });
    } catch (error: unknown) {
      if (controller.signal.aborted || request.current !== controller) return;
      if (!(error instanceof Error)) throw error;
      setState({ kind: 'failed', url });
    } finally {
      if (request.current === controller) request.current = null;
    }
  };

  const rows =
    state.kind === 'ready' ? noticeReviewRows(state.preview, props) : [];
  const applicable = rows.filter(
    (row) =>
      row.next &&
      row.current.trim() !== row.next.trim() &&
      checked.has(row.key),
  );
  const canApply =
    state.kind === 'ready' &&
    (applicable.length > 0 || cover !== null) &&
    !props.disabled;
  const step = state.kind === 'ready' ? 3 : state.kind === 'select' ? 0 : 1;

  return (
    <>
      <Button
        ref={triggerRef}
        type="button"
        variant="outline"
        className="w-full border-primary/40 font-sans text-primary sm:w-auto"
        disabled={props.disabled}
        onClick={() => {
          applied.current = false;
          setPage(0);
          setOpen(true);
        }}
      >
        <FileText aria-hidden="true" />
        공고 불러오기
      </Button>
      {open ? (
        <DialogShell
          title="공고 불러오기"
          size="lg"
          returnFocusRef={triggerRef}
          onCancel={close}
          footer={
            state.kind === 'ready' ? (
              <>
                <Button type="button" variant="outline" onClick={reset}>
                  다른 공고
                </Button>
                <Button
                  type="button"
                  disabled={!canApply}
                  onClick={() => {
                    if (!canApply || state.kind !== 'ready' || applied.current)
                      return;
                    applied.current = true;
                    const fields = applicable.reduce<ProgramNoticePatch>(
                      (patch, row) => ({ ...patch, ...row.patch }),
                      {},
                    );
                    const patch: ProgramNoticePatch = {
                      ...fields,
                      ...(cover
                        ? {
                            externalCover: {
                              sourceUrl: state.preview.sourceUrl,
                              imageUrl: cover,
                            },
                          }
                        : {}),
                    };
                    props.onApply(patch);
                    close();
                  }}
                >
                  적용
                </Button>
              </>
            ) : (
              <Button type="button" variant="outline" onClick={close}>
                닫기
              </Button>
            )
          }
        >
          <ProgramNoticeSteps step={step} />
          {state.kind === 'select' ? (
            notices.isPending ? (
              <p role="status" className="text-small text-muted-foreground">
                공고 목록을 불러오는 중…
              </p>
            ) : notices.isError ? (
              <div className="grid gap-3">
                <p role="alert">
                  공고 목록을 불러오지 못했습니다. 다시 시도하거나 닫은 후 직접
                  입력하세요.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void notices.refetch()}
                >
                  다시 시도
                </Button>
              </div>
            ) : (
              <ProgramNoticeCards
                items={notices.data.items}
                page={page}
                onPage={setPage}
                onPick={(url) => void pick(url)}
              />
            )
          ) : null}
          {state.kind === 'loading' ? (
            <p
              role="status"
              className="py-10 text-center text-small text-muted-foreground"
            >
              공고를 불러오고 내용을 추출하는 중…
            </p>
          ) : null}
          {state.kind === 'failed' ? (
            <div className="grid gap-3">
              <p role="alert">
                공고를 불러오지 못했습니다. 다시 시도하거나 다른 공고를
                선택하세요.
              </p>
              <div className="flex gap-2">
                <Button type="button" onClick={() => void pick(state.url)}>
                  다시 시도
                </Button>
                <Button type="button" variant="outline" onClick={reset}>
                  다른 공고
                </Button>
              </div>
            </div>
          ) : null}
          {state.kind === 'ready' ? (
            <ProgramNoticeReview
              preview={state.preview}
              rows={rows}
              checked={checked}
              onCheck={(key, value) =>
                setChecked((previous) => {
                  const next = new Set(previous);
                  if (value) next.add(key);
                  else next.delete(key);
                  return next;
                })
              }
              cover={cover}
              onCover={setCover}
            />
          ) : null}
        </DialogShell>
      ) : null}
    </>
  );
}
