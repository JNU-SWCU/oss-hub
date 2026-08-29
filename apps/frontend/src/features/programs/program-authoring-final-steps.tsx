'use client';

import { CalendarDays } from 'lucide-react';
import { useMemo, useState } from 'react';
import { FormSection } from '@/components/form-section';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type {
  ProgramAuthoringAction,
  ProgramAuthoringState,
} from './program-authoring-model';
import { seoulDateTimeSummary } from './program-authoring-manifest';
import { ProgramAuthoringRepositoryControl } from './program-authoring-repository-control';
import { ProgramDeadlineControl } from './program-deadline-control';
import {
  dateKey,
  monthKeyForEvents,
  type ProgramScheduleCalendarEvent,
} from './program-schedule-calendar-model';
import { ProgramScheduleRangeCalendar } from './program-schedule-range-calendar';
import type { ProgramScheduleEditableRange } from './program-schedule-range-types';
import { PROGRAM_TEMPLATE_DEFINITIONS } from './program-templates';

export function ProgramAuthoringOperationsStep({
  state,
  dispatch,
}: {
  readonly state: ProgramAuthoringState;
  readonly dispatch: (action: ProgramAuthoringAction) => void;
}) {
  return (
    <FormSection
      title="운영 설정"
      description="신청 승인 이후의 저장소 발급과 제출 마감 알림을 설정하세요."
    >
      <ProgramAuthoringRepositoryControl
        enabled={state.repositoryProvisioningEnabled}
        onEnabledChange={(enabled) =>
          dispatch({ type: 'set_repository_provisioning_enabled', enabled })
        }
      />
      <ProgramDeadlineControl
        enabled={state.notifyOnDeadline}
        onEnabledChange={(enabled) =>
          dispatch({ type: 'set_notify_on_deadline', enabled })
        }
      />
    </FormSection>
  );
}

export function ProgramAuthoringReviewStep({
  state,
}: {
  readonly state: ProgramAuthoringState;
}) {
  const category = PROGRAM_TEMPLATE_DEFINITIONS.find(
    (definition) => definition.category === state.category,
  );
  return (
    <FormSection
      title="최종 검토"
      description="확정하면 전체 내용이 한 번에 생성됩니다. 생성 전에는 서버에 프로그램이 없습니다."
    >
      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle>{state.name}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 text-body sm:grid-cols-2">
              <ReviewFact
                label="유형"
                value={category?.label ?? state.category}
              />
              <ReviewFact label="주관" value={state.organizer} />
              <ReviewFact
                label="팀 인원"
                value={`${state.teamMinSize}명 ~ ${state.teamMaxSize}명`}
              />
              <ReviewFact
                label="마일스톤"
                value={`${state.milestones.length}개`}
              />
              <ReviewFact
                label="GitHub 저장소 발급"
                value={state.repositoryProvisioningEnabled ? '사용' : '미사용'}
              />
              <ReviewFact
                label="제출 마감 알림"
                value={state.notifyOnDeadline ? '사용' : '미사용'}
              />
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarDays aria-hidden="true" />
              일정
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <ProgramAuthoringReviewCalendar state={state} />
            <dl className="grid gap-4 text-body">
              <ReviewFact
                label="신청"
                value={`${summary(state.applicationStartAt)} ~ ${summary(state.applicationEndAt)}`}
              />
              <ReviewFact
                label="운영"
                value={`${summary(state.operationStartAt)} ~ ${summary(state.operationEndAt)}`}
              />
            </dl>
          </CardContent>
        </Card>
        {state.milestones.map((milestone, index) => (
          <Card key={milestone.id}>
            <CardHeader>
              <CardTitle>
                {index + 1}. {milestone.name}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 text-body">
              <p className="text-muted-foreground">
                {summary(milestone.startAt)} ~ {summary(milestone.dueAt)}
              </p>
              <ul className="grid gap-2">
                {milestone.requirements.length === 0 ? (
                  <li>제출 없음</li>
                ) : (
                  milestone.requirements.map((requirement) => (
                    <li key={requirement.id} className="flex flex-wrap gap-2">
                      <span className="font-semibold">{requirement.name}</span>
                      <span className="text-muted-foreground">
                        내용이나 파일로 제출 가능
                        {requirement.required ? ' · 필수' : ' · 선택'}
                        {requirement.templateFile ? ' · 양식 있음' : ''}
                      </span>
                    </li>
                  ))
                )}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>
    </FormSection>
  );
}

function ProgramAuthoringReviewCalendar({
  state,
}: {
  readonly state: ProgramAuthoringState;
}) {
  const events = useMemo<readonly ProgramScheduleCalendarEvent[]>(
    () => [
      {
        id: 'application',
        label: '신청 기간',
        kind: 'APPLICATION',
        startAt: state.applicationStartAt,
        endAt: state.applicationEndAt,
      },
      {
        id: 'operation',
        label: '운영 기간',
        kind: 'OPERATION',
        startAt: state.operationStartAt,
        endAt: state.operationEndAt,
      },
      ...state.milestones.map((milestone) => ({
        id: milestone.id,
        label: milestone.name,
        kind: 'MILESTONE' as const,
        startAt: milestone.startAt,
        endAt: milestone.dueAt,
      })),
    ],
    [
      state.applicationEndAt,
      state.applicationStartAt,
      state.milestones,
      state.operationEndAt,
      state.operationStartAt,
    ],
  );
  const firstDate =
    dateKey(state.applicationStartAt) ??
    dateKey(state.operationStartAt) ??
    `${monthKeyForEvents(events)}-01`;
  const lastDate =
    dateKey(state.operationEndAt) ??
    dateKey(state.applicationEndAt) ??
    firstDate;
  const [monthKey, setMonthKey] = useState(firstDate.slice(0, 7));
  const [focusedDate, setFocusedDate] = useState(firstDate);
  const range: ProgramScheduleEditableRange = {
    id: 'review-schedule',
    label: '전체',
    kind: 'OPERATION',
    startAt: '',
    endAt: '',
    minDate: firstDate,
    maxDate: lastDate,
    startInputId: 'review-schedule-start',
    endInputId: 'review-schedule-end',
    onStartAtChange: () => undefined,
    onEndAtChange: () => undefined,
  };

  return (
    <ProgramScheduleRangeCalendar
      readOnly
      events={events}
      activeRange={range}
      monthKey={monthKey}
      focusedDate={focusedDate}
      onMonthKeyChange={setMonthKey}
      onFocusedDateChange={setFocusedDate}
      onDateSelect={() => undefined}
    />
  );
}

function ReviewFact({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div className="grid gap-1">
      <dt className="text-small text-muted-foreground">{label}</dt>
      <dd className="font-semibold break-words">{value}</dd>
    </div>
  );
}

function summary(value: string): string {
  return value.length === 0 ? '미입력' : seoulDateTimeSummary(value);
}
