'use client';

import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type {
  ProgramDeadlineMail,
  ProgramDeadlinePreview,
} from './program-deadline-api';

export function DeadlinePreviewCounts({
  preview,
}: {
  readonly preview: ProgramDeadlinePreview;
}) {
  const facts = [
    ['발송 가능', preview.recipientCount, '명'],
    ['수신 거부', preview.optedOutCount, '명'],
    ['비활성', preview.inactiveCount, '명'],
    ['이메일 없음', preview.noEmailCount, '명'],
  ] as const;
  return (
    <Card>
      <CardContent className="grid gap-4 pt-card">
        <h3 className="font-semibold">발송 대상 확인</h3>
        <dl className="grid grid-cols-2 gap-4 text-small lg:grid-cols-4">
          {facts.map(([label, count, unit]) => (
            <div
              key={label}
              className="grid gap-1"
              aria-label={`${label} ${count}${unit}`}
            >
              <dt className="text-muted-foreground">
                {label === '발송 가능' ? '학생 발송 가능' : label}
              </dt>
              <dd className="font-semibold">
                {count}
                {unit}
              </dd>
            </div>
          ))}
        </dl>
        <p className="text-small">
          <span aria-label={`대상 마일스톤 ${preview.milestoneCount}개`}>
            {preview.milestoneCount}개 마일스톤
          </span>
          의{' '}
          <span aria-label={`미제출 신청 ${preview.applicationCount}건`}>
            미제출 신청 {preview.applicationCount}건
          </span>
          을 기준으로 합니다.
        </p>
        <p
          className="border-t border-border pt-3 text-small"
          aria-label={`교직원 요약 수신 ${preview.staffRecipientCount}명`}
        >
          교직원 요약 수신 <strong>{preview.staffRecipientCount}명</strong>
        </p>
        <p className="text-small break-keep text-muted-foreground">
          제외 수는 학생 기준입니다. 미리보기는 10분 동안 유효하며, 대상이
          바뀌면 다시 계산해야 합니다.
        </p>
      </CardContent>
    </Card>
  );
}

export function DeadlinePreviewBodies({
  preview,
}: {
  readonly preview: ProgramDeadlinePreview | null;
}) {
  const [audience, setAudience] = useState<'student' | 'staff'>('student');
  const [studentIndex, setStudentIndex] = useState(0);
  const id = useId();
  if (preview === null) return null;
  const selectedIndex = Math.min(
    studentIndex,
    Math.max(0, preview.studentPreviews.length - 1),
  );
  const student = preview.studentPreviews[selectedIndex] ?? null;
  const audiences = [
    { value: 'student', label: '학생용' },
    { value: 'staff', label: '교직원용' },
  ] as const;
  return (
    <section aria-label="메일 본문 미리보기" className="grid min-w-0 gap-4">
      <div
        role="tablist"
        aria-label="미리보기 대상"
        className="flex gap-2 lg:hidden"
      >
        {audiences.map((item) => (
          <Button
            key={item.value}
            type="button"
            role="tab"
            id={`${id}-${item.value}-tab`}
            aria-controls={`${id}-${item.value}-panel`}
            aria-selected={audience === item.value}
            tabIndex={audience === item.value ? 0 : -1}
            variant={audience === item.value ? 'secondary' : 'outline'}
            onClick={() => setAudience(item.value)}
            onKeyDown={(event) => {
              if (
                !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)
              )
                return;
              event.preventDefault();
              const next =
                event.key === 'Home'
                  ? 'student'
                  : event.key === 'End'
                    ? 'staff'
                    : audience === 'student'
                      ? 'staff'
                      : 'student';
              setAudience(next);
              document.getElementById(`${id}-${next}-tab`)?.focus();
            }}
          >
            {item.label}
          </Button>
        ))}
      </div>
      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        {audiences.map((item) => (
          <div
            key={item.value}
            id={`${id}-${item.value}-panel`}
            role="tabpanel"
            aria-label={`${item.label} 메일`}
            className={`${audience === item.value ? 'grid' : 'hidden'} min-w-0 content-start gap-3 lg:grid`}
          >
            <h3 className="hidden font-semibold lg:block">{item.label} 메일</h3>
            {item.value === 'student' && preview.studentPreviews.length > 0 ? (
              <div className="grid gap-2">
                <label
                  htmlFor={`${id}-student`}
                  className="text-small font-medium"
                >
                  미리 볼 학생
                </label>
                <select
                  id={`${id}-student`}
                  className="h-control w-full min-w-0 rounded-control border border-input bg-background px-3 text-small"
                  value={selectedIndex}
                  onChange={(event) =>
                    setStudentIndex(Number(event.target.value))
                  }
                >
                  {preview.studentPreviews.map((mail, index) => (
                    <option key={index} value={index}>
                      {mail.displayName}
                    </option>
                  ))}
                </select>
                <p className="text-small text-muted-foreground">
                  본문 확인만 바뀌며 실제 발송 대상은 바뀌지 않습니다.
                </p>
              </div>
            ) : null}
            <DeadlineMailBody
              mail={item.value === 'student' ? student : preview.staffPreview}
              label={item.label}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

function DeadlineMailBody({
  mail,
  label,
}: {
  readonly mail: ProgramDeadlineMail | null;
  readonly label: string;
}) {
  if (mail === null)
    return (
      <p className="rounded-card border border-border p-card text-small text-muted-foreground">
        발송 대상이 없어 {label} 메일 본문이 없습니다.
      </p>
    );
  // The sandbox keeps the server-rendered template isolated; links open separately so the draft remains here.
  return (
    <div className="grid min-w-0 gap-3">
      <p className="break-words text-small">
        <span className="font-semibold">제목: </span>
        {mail.subject}
      </p>
      <iframe
        title={`${label} 메일 본문`}
        srcDoc={mail.html}
        sandbox="allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer"
        className="h-[32rem] w-full min-w-0 rounded-card border border-border bg-white"
      />
    </div>
  );
}
