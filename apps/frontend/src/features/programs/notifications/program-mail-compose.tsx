'use client';

import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type {
  ProgramMailPreview,
  ProgramMailRecipients,
  ProgramMailSendResult,
} from './program-mail-dto';
import {
  PROGRAM_MAIL_BODY_LIMIT,
  PROGRAM_MAIL_SUBJECT_LIMIT,
} from './program-mail-dialog-state';
import { ProgramMailRecipientTree } from './program-mail-recipient-tree';

type ProgramMailComposeModel = {
  readonly recipients: ProgramMailRecipients;
  readonly selectedIds: ReadonlySet<string>;
  readonly subject: string;
  readonly body: string;
};

type ProgramMailComposeChanges = {
  readonly selection: (selectedIds: ReadonlySet<string>) => void;
  readonly subject: (subject: string) => void;
  readonly body: (body: string) => void;
};

export function ProgramMailCompose({
  model,
  selectionRejected,
  onChange,
}: {
  readonly model: ProgramMailComposeModel;
  readonly selectionRejected: boolean;
  readonly onChange: ProgramMailComposeChanges;
}) {
  const { recipientLimit } = model.recipients;
  const availableIds = model.recipients.teams.flatMap((team) =>
    team.applicants.flatMap((applicant) =>
      applicant.mailAvailable ? [applicant.id] : [],
    ),
  );
  const deadlineIds = model.recipients.teams.flatMap((team) =>
    team.deadlineEligible
      ? team.applicants.flatMap((applicant) =>
          applicant.mailAvailable ? [applicant.id] : [],
        )
      : [],
  );
  return (
    <div className="grid gap-8">
      <section className="grid gap-4" aria-labelledby="mail-recipients-title">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="mail-recipients-title" className="font-heading font-semibold">
            받는 학생
          </h2>
          <span className="text-small tabular-nums text-muted-foreground">
            {model.selectedIds.size}명 선택
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onChange.selection(new Set(availableIds))}
          >
            전체 선택
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onChange.selection(new Set(deadlineIds))}
          >
            24시간 이내 필수 서류 미제출자 선택
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange.selection(new Set())}
          >
            선택 해제
          </Button>
        </div>
        {selectionRejected || model.selectedIds.size > recipientLimit ? (
          <p role="alert" className="text-small text-destructive">
            수신자는 최대 {recipientLimit}명까지 선택할 수 있습니다.
          </p>
        ) : null}
        {model.recipients.teams.length === 0 ? (
          <p className="text-small text-muted-foreground">
            신청 학생이 없습니다.
          </p>
        ) : (
          <ProgramMailRecipientTree
            teams={model.recipients.teams}
            selectedIds={model.selectedIds}
            recipientLimit={recipientLimit}
            onSelectionChange={onChange.selection}
          />
        )}
      </section>
      <section className="grid gap-4" aria-labelledby="mail-content-title">
        <h2 id="mail-content-title" className="font-heading font-semibold">
          메일 내용
        </h2>
        <Field>
          <FieldLabel htmlFor="program-mail-subject">제목</FieldLabel>
          <Input
            id="program-mail-subject"
            value={model.subject}
            maxLength={PROGRAM_MAIL_SUBJECT_LIMIT}
            onChange={(event) => onChange.subject(event.target.value)}
          />
          <p className="text-small tabular-nums text-muted-foreground">
            {model.subject.length} / {PROGRAM_MAIL_SUBJECT_LIMIT}자
          </p>
        </Field>
        <Field>
          <FieldLabel htmlFor="program-mail-body">본문</FieldLabel>
          <Textarea
            id="program-mail-body"
            value={model.body}
            maxLength={PROGRAM_MAIL_BODY_LIMIT}
            rows={8}
            onChange={(event) => onChange.body(event.target.value)}
          />
          <p className="text-small tabular-nums text-muted-foreground">
            {model.body.length} / {PROGRAM_MAIL_BODY_LIMIT}자
          </p>
        </Field>
      </section>
    </div>
  );
}

export function ProgramMailPreviewView({
  preview,
}: {
  readonly preview: ProgramMailPreview;
}) {
  return (
    <div className="grid gap-6">
      <section className="grid gap-2" aria-labelledby="mail-preview-recipients">
        <h2 id="mail-preview-recipients" className="font-heading font-semibold">
          받는 학생 {preview.recipientCount}명
        </h2>
        <p className="text-small text-muted-foreground break-words">
          {preview.recipientNames.join(', ')}
        </p>
      </section>
      <dl className="grid gap-3 rounded-card border border-border p-4">
        <div>
          <dt className="text-small text-muted-foreground">프로그램</dt>
          <dd>{preview.programName}</dd>
        </div>
        <div>
          <dt className="text-small text-muted-foreground">보낸 사람</dt>
          <dd>{preview.senderName}</dd>
        </div>
        <div>
          <dt className="text-small text-muted-foreground">제목</dt>
          <dd className="break-words">{preview.renderedSubject}</dd>
        </div>
      </dl>
      <section className="grid gap-2" aria-labelledby="mail-preview-body">
        <h2 id="mail-preview-body" className="font-heading font-semibold">
          본문
        </h2>
        <p className="whitespace-pre-wrap break-words">{preview.body}</p>
      </section>
      <p className="border-t border-border pt-4 text-small text-muted-foreground">
        {preview.footer}
      </p>
      <p id="mail-send-warning" className="text-small font-semibold">
        보낸 메일은 취소할 수 없습니다.
      </p>
    </div>
  );
}

export function ProgramMailResult({
  result,
}: {
  readonly result: Omit<ProgramMailSendResult, 'previewVersion'>;
}) {
  return (
    <Alert>
      <AlertTitle>
        {result.status === 'IN_PROGRESS' ? (
          '메일 발송을 처리 중입니다.'
        ) : (
          <>
            <data value={result.sentCount}>{result.sentCount}</data>명에게
            메일을 보냈습니다.
          </>
        )}
      </AlertTitle>
      {result.status === 'COMPLETED' ? (
        <AlertDescription>
          중복 생략 {result.duplicateCount}명 · 발송 실패 {result.failedCount}명
          · 발송 결과 확인 불가{' '}
          <data value={result.unknownCount ?? 0}>
            {result.unknownCount ?? 0}
          </data>
          명
        </AlertDescription>
      ) : null}
    </Alert>
  );
}
