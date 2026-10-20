'use client';

import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError, isUnexpectedApiProblem } from '@/lib/api-client';
import { updateMilestoneDocumentGrace } from './milestone-document-api';
import type { MilestoneDocument } from './milestone-document-dto';
import { toDateTimeLocal } from '../authoring/program-edit-flow';
import { formatSeoulShortDateTime } from '../catalog/program-detail-format';
import { seoulDateTimeValue } from '../authoring/seoul-date-time';

export function MilestoneDocumentGraceEditor({
  document,
  onRefresh,
}: {
  readonly document: MilestoneDocument;
  readonly onRefresh: () => Promise<boolean>;
}) {
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(() =>
    document.graceDueAt == null ? '' : toDateTimeLocal(document.graceDueAt),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(clear = false) {
    const time = clear ? null : seoulDateTimeValue(value);
    if (!clear && time === null) {
      setError('유예 기한을 골라 주세요.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await updateMilestoneDocumentGrace(
        document.milestoneId,
        document.id,
        time === null ? null : new Date(time).toISOString(),
      );
      if (await onRefresh()) setEditing(false);
      else
        setError(
          '저장했지만 최신 기한을 불러오지 못했습니다. 다시 저장해 확인해 주세요.',
        );
    } catch (failure: unknown) {
      setError(
        failure instanceof ApiError && !isUnexpectedApiProblem(failure.problem)
          ? failure.problem.detail
          : '유예 기한을 저장하지 못했습니다. 다시 시도해 주세요.',
      );
    } finally {
      setSaving(false);
    }
  }

  if (!editing)
    return (
      <div className="flex flex-wrap items-center gap-2 text-small text-muted-foreground">
        {document.graceDueAt == null ? null : (
          <span>
            유예 기한: {formatSeoulShortDateTime(document.graceDueAt)} (한국
            시간)
          </span>
        )}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-label={`${document.name} 유예 기한 설정`}
          onClick={() => setEditing(true)}
        >
          {document.graceDueAt == null ? '유예 기한 설정' : '유예 기한 변경'}
        </Button>
      </div>
    );

  return (
    <form
      className="grid gap-2 rounded-control border border-border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <label htmlFor={id} className="text-small font-medium">
        {document.name} 유예 기한 (한국 시간)
      </label>
      <Input
        id={id}
        type="datetime-local"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        disabled={saving}
        aria-describedby={`${id}-description${error === null ? '' : ` ${id}-error`}`}
        aria-invalid={error !== null}
      />
      <p id={`${id}-description`} className="text-small text-muted-foreground">
        원래 마감 뒤에도 이 시각까지 첫 제출과 교체를 받습니다. 지각으로
        표시되며, 보완 요청의 재제출 기한은 바뀌지 않습니다.
      </p>
      {error === null ? null : (
        <p
          id={`${id}-error`}
          role="alert"
          className="text-small text-destructive"
        >
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? '저장 중…' : '유예 기한 저장'}
        </Button>
        {document.graceDueAt == null ? null : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={saving}
            onClick={() => void save(true)}
          >
            유예 해제
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={saving}
          onClick={() => {
            setEditing(false);
            setError(null);
            setValue(
              document.graceDueAt == null
                ? ''
                : toDateTimeLocal(document.graceDueAt),
            );
          }}
        >
          취소
        </Button>
      </div>
    </form>
  );
}
