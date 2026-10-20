'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api-client';
import { leaveApplicationPreparation } from './api';

export function ApplicationPreparationNotice({
  programId,
  isLeader,
  onChanged,
}: {
  readonly programId: string;
  readonly isLeader: boolean;
  readonly onChanged: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function leave() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await leaveApplicationPreparation(programId);
      onChanged();
    } catch (failure) {
      setError(
        failure instanceof ApiError
          ? failure.problem.detail
          : '신청 준비를 변경하지 못했습니다. 다시 시도해 주세요.',
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground" role="status">
        현재 팀원 초대를 위한 신청 준비 중입니다. 최종 제출할 때 팀과 신청서가
        함께 등록됩니다.
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => void leave()}
      >
        {pending
          ? '처리 중…'
          : isLeader
            ? '신청 준비 삭제'
            : '신청 준비 나가기'}
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
