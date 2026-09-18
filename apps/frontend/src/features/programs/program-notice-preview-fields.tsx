import { useId } from 'react';
import { ProgramCover } from '@/components';
import type {
  ProgramNoticePatch,
  ProgramNoticePreview,
} from './program-notice-api';

export function ProgramNoticePreviewFields({
  preview,
  currentName,
  currentDescription,
  hasCover,
  patch,
  onChange,
}: {
  readonly preview: ProgramNoticePreview;
  readonly currentName: string;
  readonly currentDescription: string;
  readonly hasCover: boolean;
  readonly patch: ProgramNoticePatch;
  readonly onChange: (patch: ProgramNoticePatch) => void;
}) {
  const id = useId();
  return (
    <div className="grid gap-5">
      <a
        href={preview.sourceUrl}
        target="_blank"
        rel="noreferrer"
        className="w-fit text-sm text-primary underline underline-offset-4"
      >
        원문 공지 확인
      </a>
      {preview.warnings.includes('EXTERNAL_APPLICATION_LINK') ? (
        <p className="text-sm leading-6 text-muted-foreground">
          원문에 신청 안내가 있습니다. 우리 사이트의 신청·제출 방식에 맞게
          설명을 확인해 주세요.
        </p>
      ) : null}
      <div className="grid gap-2">
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input
            type="checkbox"
            name="notice-name"
            checked={patch.name !== undefined}
            disabled={!preview.name}
            aria-describedby={currentName ? `${id}-name-hint` : undefined}
            onChange={(event) =>
              onChange({
                ...patch,
                name: event.target.checked ? preview.name : undefined,
              })
            }
            className="size-4 accent-primary"
          />
          프로그램명 가져오기
        </label>
        {currentName ? (
          <p id={`${id}-name-hint`} className="text-sm text-muted-foreground">
            선택하면 현재 프로그램명을 바꿉니다.
          </p>
        ) : null}
        <p className="break-keep text-sm">{preview.name}</p>
      </div>
      <div className="grid gap-2">
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input
            type="checkbox"
            name="notice-description"
            checked={patch.description !== undefined}
            disabled={!preview.description}
            aria-describedby={
              currentDescription ? `${id}-description-hint` : undefined
            }
            onChange={(event) =>
              onChange({
                ...patch,
                description: event.target.checked
                  ? preview.description
                  : undefined,
              })
            }
            className="size-4 accent-primary"
          />
          설명 가져오기
        </label>
        {currentDescription ? (
          <p
            id={`${id}-description-hint`}
            className="text-sm text-muted-foreground"
          >
            선택하면 현재 설명을 바꿉니다.
          </p>
        ) : null}
        <p
          data-slot="notice-description-preview"
          className="rounded-control border border-border bg-muted/30 p-3 text-sm leading-6 break-keep break-words whitespace-pre-wrap"
        >
          {preview.description || '가져올 설명이 없습니다. 직접 입력해 주세요.'}
        </p>
      </div>
      {preview.coverImages.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          이미지를 찾지 못했습니다. 기존 이미지를 유지하거나 직접 올릴 수
          있습니다.
        </p>
      ) : (
        <fieldset className="grid gap-3">
          <legend className="mb-2 text-sm font-semibold">대표 이미지</legend>
          <p className="text-sm text-muted-foreground">
            {hasCover ? '이미지를 선택하면 현재 대표 이미지를 바꿉니다. ' : ''}
            원문에서 이미지가 삭제되면 표시되지 않을 수 있습니다.
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="notice-cover"
              value="none"
              checked={patch.externalCover === undefined}
              onChange={() => onChange({ ...patch, externalCover: undefined })}
              className="size-4 accent-primary"
            />
            이미지 가져오지 않기
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            {preview.coverImages.map((imageUrl, index) => (
              <label
                key={imageUrl}
                className="grid cursor-pointer gap-2 rounded-card border border-border p-3 focus-within:outline-2 focus-within:outline-ring"
              >
                <span className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="notice-cover"
                    value={index}
                    checked={patch.externalCover?.imageUrl === imageUrl}
                    onChange={() =>
                      onChange({
                        ...patch,
                        externalCover: {
                          sourceUrl: preview.sourceUrl,
                          imageUrl,
                        },
                      })
                    }
                    className="size-4 accent-primary"
                  />
                  이미지 {index + 1}
                </span>
                <ProgramCover src={imageUrl} />
              </label>
            ))}
          </div>
        </fieldset>
      )}
    </div>
  );
}
