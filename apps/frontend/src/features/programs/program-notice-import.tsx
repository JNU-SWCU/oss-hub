'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, FieldLabel } from '@/components/ui/field';
import { ApiError } from '@/lib/api-client';
import { ProgramAuthoringDialog } from './program-authoring-dialog';
import {
  previewProgramNotice,
  type ProgramNoticePatch,
  type ProgramNoticePreview,
} from './program-notice-api';
import { ProgramNoticePreviewFields } from './program-notice-preview-fields';

type PreviewState =
  | { readonly kind: 'idle' | 'loading' }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'ready'; readonly preview: ProgramNoticePreview };

export function ProgramNoticeImport({
  currentName,
  currentDescription,
  hasCover,
  sourceUrl = '',
  disabled = false,
  onApply,
}: {
  readonly currentName: string;
  readonly currentDescription: string;
  readonly hasCover: boolean;
  readonly sourceUrl?: string;
  readonly disabled?: boolean;
  readonly onApply: (patch: ProgramNoticePatch) => void;
}) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const request = useRef<AbortController | null>(null);
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState(sourceUrl);
  const [state, setState] = useState<PreviewState>({ kind: 'idle' });
  const [patch, setPatch] = useState<ProgramNoticePatch>({});

  useEffect(() => () => request.current?.abort(), []);

  const cancelRequest = () => {
    request.current?.abort();
    request.current = null;
  };
  const close = () => {
    cancelRequest();
    setOpen(false);
    setState({ kind: 'idle' });
    setPatch({});
  };
  const load = async () => {
    cancelRequest();
    const controller = new AbortController();
    request.current = controller;
    setState({ kind: 'loading' });
    setPatch({});
    try {
      const preview = await previewProgramNotice(url.trim(), controller.signal);
      if (controller.signal.aborted || request.current !== controller) return;
      setState({ kind: 'ready', preview });
      setPatch({
        ...(!currentName.trim() && preview.name ? { name: preview.name } : {}),
        ...(!currentDescription.trim() && preview.description
          ? { description: preview.description }
          : {}),
        ...(!hasCover &&
        preview.coverImages.length === 1 &&
        preview.coverImages[0]
          ? {
              externalCover: {
                sourceUrl: preview.sourceUrl,
                imageUrl: preview.coverImages[0],
              },
            }
          : {}),
      });
    } catch (error: unknown) {
      if (controller.signal.aborted || request.current !== controller) return;
      setState({ kind: 'failed', message: noticeFailure(error) });
    }
  };
  const canApply =
    state.kind === 'ready' &&
    (patch.name !== undefined ||
      patch.description !== undefined ||
      patch.externalCover !== undefined);

  return (
    <>
      <Button
        ref={triggerRef}
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        공지에서 가져오기
      </Button>
      {open ? (
        <ProgramAuthoringDialog
          title="공지에서 가져오기"
          size="lg"
          returnFocusRef={triggerRef}
          onCancel={close}
          footer={
            <>
              <Button type="button" variant="outline" onClick={close}>
                닫기
              </Button>
              <Button
                type="button"
                disabled={!canApply || disabled}
                onClick={() => {
                  if (!canApply) return;
                  onApply({
                    ...(patch.name !== undefined ? { name: patch.name } : {}),
                    ...(patch.description !== undefined
                      ? { description: patch.description }
                      : {}),
                    ...(patch.externalCover !== undefined
                      ? { externalCover: patch.externalCover }
                      : {}),
                  });
                  close();
                }}
              >
                선택한 내용 적용
              </Button>
            </>
          }
        >
          <Field>
            <FieldLabel htmlFor={id}>sojoong 공지 URL</FieldLabel>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id={id}
                type="url"
                value={url}
                placeholder="https://sojoong.kr/notice/…"
                onChange={(event) => {
                  cancelRequest();
                  setUrl(event.target.value);
                  setState({ kind: 'idle' });
                  setPatch({});
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' || event.nativeEvent.isComposing)
                    return;
                  event.preventDefault();
                  if (url.trim() && state.kind !== 'loading') void load();
                }}
              />
              <Button
                type="button"
                variant="outline"
                disabled={!url.trim() || state.kind === 'loading'}
                onClick={() => void load()}
              >
                불러오기
              </Button>
            </div>
          </Field>
          {state.kind === 'loading' ? (
            <p role="status" className="text-sm text-muted-foreground">
              공지를 불러오는 중…
            </p>
          ) : null}
          {state.kind === 'failed' ? (
            <p role="alert" className="text-sm text-destructive">
              {state.message}
            </p>
          ) : null}
          {state.kind === 'ready' ? (
            <ProgramNoticePreviewFields
              preview={state.preview}
              currentName={currentName}
              currentDescription={currentDescription}
              hasCover={hasCover}
              patch={patch}
              onChange={setPatch}
            />
          ) : null}
          <p className="text-sm leading-6 text-muted-foreground">
            신청 기간, 마일스톤, 제출 항목과 기한은 가져오지 않으니 직접 설정해
            주세요.
          </p>
        </ProgramAuthoringDialog>
      ) : null}
    </>
  );
}

function noticeFailure(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.problem.status === 400)
      return 'sojoong 공지 주소인지 확인해 주세요. 가져오기 없이 직접 입력할 수도 있습니다.';
    if (error.problem.status === 429)
      return '요청이 많아 잠시 기다려야 합니다. 잠시 후 다시 시도하거나 직접 입력해 주세요.';
    if (
      error.problem.status === 401 ||
      error.problem.status === 403 ||
      error.problem.status === 409
    )
      return '공지를 가져올 권한을 확인하지 못했습니다. 로그인 상태를 확인하거나 직접 입력해 주세요.';
  }
  return '공지를 가져오지 못했습니다. 주소를 확인해 다시 시도하거나 직접 입력해 주세요.';
}
