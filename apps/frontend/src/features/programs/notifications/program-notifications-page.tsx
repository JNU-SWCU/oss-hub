'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BellOff, BellRing, RefreshCw, Send } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Skeleton, SkeletonBlock } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
  DialogShell,
  EmptyState,
  FailureState,
  PageBody,
  PageHeader,
} from '@/components';
import { programEditHref } from '@/lib/program-route';
import { programHref } from '../program-paths';
import { useEditableProgramQuery } from '../authoring/queries';
import type { ProgramDeadlineGuidance } from './program-deadline-dto';
import {
  DeadlinePreviewBodies,
  DeadlinePreviewCounts,
} from './program-deadline-preview';
import { useProgramDeadlinePreview } from './use-program-deadline-preview';

const PAGE_WIDTH = 'max-w-4xl';
const OPERATIONS_SECTION_HASH = '#operations';
const GUIDANCE_LIMIT = 4000;
const REFRESH_REQUIRED_MESSAGE =
  '현재 안내와 대상으로 다시 미리본 뒤 보낼 수 있습니다.';
const GUIDANCE_FIELDS: readonly {
  readonly key: keyof ProgramDeadlineGuidance;
  readonly label: string;
}[] = [
  { key: 'studentGuidance', label: '학생용 추가 안내' },
  { key: 'staffGuidance', label: '교직원용 추가 안내' },
];

export function ProgramNotificationsPage({
  programId,
}: {
  readonly programId: string;
}) {
  const query = useEditableProgramQuery(programId);

  if (query.isPending) {
    return (
      <PageBody className={PAGE_WIDTH} aria-label="알림 불러오는 중">
        <Skeleton label="알림 불러오는 중" className="flex flex-col gap-12">
          <SkeletonBlock className="h-20 rounded-card" />
          <SkeletonBlock className="h-72 rounded-card" />
        </Skeleton>
      </PageBody>
    );
  }

  if (query.isError) {
    return (
      <PageBody className={PAGE_WIDTH}>
        <FailureState
          title="프로그램을 불러오지 못했습니다"
          onRetry={() => void query.refetch()}
        />
      </PageBody>
    );
  }

  const program = query.data;

  return (
    <PageBody className={PAGE_WIDTH}>
      <div className="flex flex-col gap-4">
        <Button asChild variant="ghost" size="sm" className="self-start">
          <Link href={programHref(program.id)}>← 프로그램 개요</Link>
        </Button>
        <PageHeader title="알림" description={program.name} />
      </div>
      {program.notifyOnDeadline ? (
        <DeadlineNoticeSendFlow programId={program.id} />
      ) : (
        <EmptyState
          className="break-keep"
          icon={<BellOff className="size-8" />}
          title="제출 마감 알림이 꺼져 있습니다"
          description="프로그램 편집의 운영 설정에서 제출 마감 알림을 켜고 저장하면 이 페이지에서 보낼 수 있습니다."
          action={
            <Button asChild variant="outline">
              <Link
                href={`${programEditHref(program.id)}${OPERATIONS_SECTION_HASH}`}
              >
                운영 설정 열기
              </Link>
            </Button>
          }
        />
      )}
    </PageBody>
  );
}

function DeadlineNoticeSendFlow({ programId }: { readonly programId: string }) {
  const {
    guidance,
    preview,
    result,
    busy,
    error,
    needsRefresh,
    invalidGuidance,
    changeGuidance,
    loadPreview,
    send,
  } = useProgramDeadlinePreview(programId, true);
  const [confirming, setConfirming] = useState(false);
  const sendInFlight = useRef(false);
  const latestLoadPreview = useRef(loadPreview);

  useEffect(() => {
    latestLoadPreview.current = loadPreview;
  });

  useEffect(() => {
    void latestLoadPreview.current();
  }, [programId]);

  useEffect(() => {
    if (preview === null) setConfirming(false);
  }, [preview]);

  const recipientTotal =
    preview === null ? 0 : preview.recipientCount + preview.staffRecipientCount;
  const canSend =
    preview !== null &&
    busy === null &&
    !invalidGuidance &&
    !needsRefresh &&
    recipientTotal > 0;

  const confirmSend = async () => {
    if (sendInFlight.current || busy !== null) return;
    sendInFlight.current = true;
    try {
      await send();
    } finally {
      sendInFlight.current = false;
    }
    setConfirming(false);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>제출 마감 알림 보내기</CardTitle>
        <CardDescription className="break-keep">
          마감까지 24시간 이내인 필수 서류를 아직 내지 않은 참여자에게 메일을
          보냅니다. 대상 확인, 추가 안내, 보내기 순서로 진행합니다.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="grid min-w-0 gap-10">
          <SendStep
            number={1}
            title="발송 대상"
            description="지금 기준으로 메일을 받을 사람을 계산합니다."
          >
            {preview !== null ? (
              <DeadlinePreviewCounts preview={preview} />
            ) : busy === 'preview' ? (
              <Skeleton label="발송 대상 계산 중">
                <SkeletonBlock className="h-40 rounded-card" />
              </Skeleton>
            ) : (
              <p
                role="status"
                className="rounded-card border border-dashed border-border p-card text-small break-keep text-muted-foreground"
              >
                {needsRefresh
                  ? '발송 대상을 다시 계산해야 합니다. 2단계에서 미리보기를 새로고침하세요.'
                  : '발송 대상을 아직 계산하지 못했습니다. 2단계에서 미리보기를 새로고침하세요.'}
              </p>
            )}
          </SendStep>
          <SendStep
            number={2}
            title="추가 안내"
            description="메일 본문 아래에 덧붙일 안내입니다. 내용을 바꾸면 미리보기를 새로고침해야 보낼 수 있습니다."
          >
            <div className="grid min-w-0 gap-4 lg:grid-cols-2">
              {GUIDANCE_FIELDS.map(({ key, label }) => (
                <Field key={key}>
                  <FieldLabel htmlFor={key}>{label}</FieldLabel>
                  <Textarea
                    id={key}
                    aria-label={label}
                    aria-describedby={`${key}-count`}
                    aria-invalid={guidance[key].length > GUIDANCE_LIMIT}
                    value={guidance[key]}
                    disabled={busy === 'send'}
                    maxLength={GUIDANCE_LIMIT}
                    rows={4}
                    onChange={(event) =>
                      changeGuidance(key, event.target.value)
                    }
                  />
                  <p
                    id={`${key}-count`}
                    className="text-small text-muted-foreground"
                  >
                    {guidance[key].length.toLocaleString('ko-KR')} /{' '}
                    {GUIDANCE_LIMIT.toLocaleString('ko-KR')}자
                  </p>
                </Field>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="outline"
                disabled={busy !== null || invalidGuidance}
                onClick={() => void loadPreview()}
              >
                <RefreshCw aria-hidden="true" />
                {busy === 'preview' ? '계산 중…' : '미리보기 새로고침'}
              </Button>
              {needsRefresh && preview === null && busy === null ? (
                <p role="status" className="text-small text-muted-foreground">
                  {REFRESH_REQUIRED_MESSAGE}
                </p>
              ) : null}
            </div>
            <DeadlinePreviewBodies preview={preview} />
          </SendStep>
          <SendStep
            number={3}
            title="보내기"
            description="미리보기와 같은 대상에게 보냅니다. 보낸 메일은 취소할 수 없습니다."
          >
            {result ? (
              <Alert>
                <BellRing aria-hidden="true" />
                <AlertTitle>
                  학생 {result.sentCount}명에게 보냈습니다.
                </AlertTitle>
                <AlertDescription>
                  학생 중복 생략 {result.duplicateCount}명 · 학생 발송 실패{' '}
                  {result.failedCount}명. 교직원 발송 결과는 이 수에 포함되지
                  않습니다.
                </AlertDescription>
              </Alert>
            ) : null}
            {error ? (
              <Alert variant="destructive">
                <AlertTitle>마감 알림을 처리하지 못했습니다</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                disabled={!canSend}
                onClick={() => setConfirming(true)}
              >
                <Send aria-hidden="true" />
                {preview === null ? '보내기' : `${recipientTotal}명에게 보내기`}
              </Button>
            </div>
          </SendStep>
        </ol>
      </CardContent>
      {confirming && preview !== null ? (
        <DeadlineSendConfirmation
          studentCount={preview.recipientCount}
          staffCount={preview.staffRecipientCount}
          busy={busy === 'send'}
          onConfirm={() => void confirmSend()}
          onClose={() => setConfirming(false)}
        />
      ) : null}
    </Card>
  );
}

function SendStep({
  number,
  title,
  description,
  children,
}: {
  readonly number: number;
  readonly title: string;
  readonly description: string;
  readonly children: ReactNode;
}) {
  return (
    <li className="grid min-w-0 gap-4">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="grid size-6 shrink-0 place-items-center rounded-full border border-border text-small font-semibold"
        >
          {number}
        </span>
        <div className="grid min-w-0 gap-1">
          <h2 className="font-heading leading-tight font-semibold break-keep">
            {title}
          </h2>
          <p className="text-small text-muted-foreground break-keep">
            {description}
          </p>
        </div>
      </div>
      <div className="grid min-w-0 gap-4 sm:pl-9">{children}</div>
    </li>
  );
}

function DeadlineSendConfirmation({
  studentCount,
  staffCount,
  busy,
  onConfirm,
  onClose,
}: {
  readonly studentCount: number;
  readonly staffCount: number;
  readonly busy: boolean;
  readonly onConfirm: () => void;
  readonly onClose: () => void;
}) {
  return (
    <DialogShell
      kind="alert"
      title="마감 알림을 보낼까요?"
      description={`학생 ${studentCount}명, 교직원 ${staffCount}명에게 마감 알림을 보냅니다. 보낸 메일은 취소할 수 없습니다.`}
      busy={busy}
      className="max-w-lg"
      onCancel={onClose}
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={onClose}
          >
            취소
          </Button>
          <Button type="button" disabled={busy} onClick={onConfirm}>
            {busy ? '보내는 중…' : '보내기'}
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted-foreground [word-break:keep-all]">
        미리보기에서 확인한 대상과 안내 문구 그대로 보냅니다. 그 사이 대상이
        바뀌었으면 보내지 않고 다시 미리보기를 요청합니다.
      </p>
    </DialogShell>
  );
}
