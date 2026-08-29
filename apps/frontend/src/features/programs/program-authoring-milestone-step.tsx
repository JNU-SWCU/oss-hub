'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { FormSection } from '@/components/form-section';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { FieldError } from '@/components/ui/field';
import type { ProgramAuthoringMilestone } from './program-authoring-model';
import type {
  ProgramAuthoringAction,
  ProgramAuthoringState,
} from './program-authoring-model';
import { ProgramAuthoringMilestoneDialog } from './program-authoring-milestone-dialog';
import {
  dateKey,
  monthKeyForEvents,
  type ProgramScheduleCalendarEvent,
} from './program-schedule-calendar-model';
import { ProgramScheduleRangeCalendar } from './program-schedule-range-calendar';
import { formatKoreanDate } from './program-schedule-range-selection';
import type { ProgramAuthoringIssue } from './program-authoring-validation';

export function ProgramAuthoringMilestoneStep({
  state,
  issues,
  dispatch,
  newId,
  onRequirementFileChange,
  onRequirementRemove,
  onMilestoneCancel,
  onMilestoneEditStart,
  onMilestoneSave,
}: {
  readonly state: ProgramAuthoringState;
  readonly issues: readonly ProgramAuthoringIssue[];
  readonly dispatch: (action: ProgramAuthoringAction) => void;
  readonly newId: () => string;
  readonly onRequirementFileChange: (
    milestoneId: string,
    requirementId: string,
    file: File | null,
  ) => void;
  readonly onRequirementRemove: (
    milestoneId: string,
    requirementId: string,
  ) => void;
  readonly onMilestoneCancel: (
    milestoneId: string,
    snapshot: ProgramAuthoringMilestone | null,
  ) => void;
  readonly onMilestoneEditStart: (milestone: ProgramAuthoringMilestone) => void;
  readonly onMilestoneSave: (milestoneId: string) => void;
}) {
  const [anchorDate, setAnchorDate] = useState<string | null>(null);
  const [editing, setEditing] = useState<{
    id: string;
    snapshot: ProgramAuthoringMilestone | null;
    showValidation: boolean;
  } | null>(null);
  const handledIssueKeyRef = useRef('');
  const operationStart = dateKey(state.operationStartAt);
  const operationEnd = dateKey(state.operationEndAt);
  const hiddenDraftId = editing?.snapshot === null ? editing.id : null;
  const visibleMilestones = useMemo(
    () => state.milestones.filter(({ id }) => id !== hiddenDraftId),
    [hiddenDraftId, state.milestones],
  );
  const events = useMemo<readonly ProgramScheduleCalendarEvent[]>(() => {
    const candidates: ProgramScheduleCalendarEvent[] = [
      {
        id: 'operation',
        label: '운영 기간',
        kind: 'OPERATION',
        startAt: state.operationStartAt,
        endAt: state.operationEndAt,
      },
      ...state.milestones.map((milestone) => ({
        id: milestone.id,
        label: milestone.name || '새 마일스톤',
        kind: 'MILESTONE' as const,
        startAt: milestone.startAt,
        endAt: milestone.dueAt,
      })),
    ];
    return candidates.filter((event) => event.startAt && event.endAt);
  }, [state.milestones, state.operationEndAt, state.operationStartAt]);
  const calendarStart = operationStart ?? `${monthKeyForEvents(events)}-01`;
  const [monthKey, setMonthKey] = useState(calendarStart.slice(0, 7));
  const [focusedDate, setFocusedDate] = useState(calendarStart);
  const milestone = editing
    ? state.milestones.find((candidate) => candidate.id === editing.id)
    : undefined;
  const issueKey = issues
    .map(({ path, message }) => `${path}:${message}`)
    .join('|');

  useEffect(() => {
    if (issueKey === '') {
      handledIssueKeyRef.current = '';
      return;
    }
    if (handledIssueKeyRef.current === issueKey || editing !== null) return;
    handledIssueKeyRef.current = issueKey;
    const invalid = milestoneForIssues(state.milestones, issues);
    if (invalid === undefined) return;
    onMilestoneEditStart(invalid);
    setEditing({ id: invalid.id, snapshot: invalid, showValidation: true });
  }, [editing, issueKey, issues, onMilestoneEditStart, state.milestones]);

  function startDraft(startAt = '', dueAt = '') {
    const id = newId();
    dispatch({ type: 'add_milestone', milestoneId: id });
    if (startAt)
      dispatch({
        type: 'set_milestone_field',
        milestoneId: id,
        field: 'startAt',
        value: startAt,
      });
    if (dueAt)
      dispatch({
        type: 'set_milestone_field',
        milestoneId: id,
        field: 'dueAt',
        value: dueAt,
      });
    setEditing({ id, snapshot: null, showValidation: false });
  }

  function selectDate(value: string) {
    if (anchorDate === null) {
      setAnchorDate(value);
      return;
    }
    const [start, due] = [anchorDate, value].sort();
    setAnchorDate(null);
    startDraft(`${start}T00:00`, `${due}T23:59`);
  }

  function cancel() {
    if (!editing) return;
    if (editing.snapshot)
      dispatch({ type: 'replace_milestone', milestone: editing.snapshot });
    onMilestoneCancel(editing.id, editing.snapshot);
    setEditing(null);
  }

  const activeRange = {
    id: 'new-milestone',
    label: '마일스톤',
    kind: 'MILESTONE' as const,
    startAt: anchorDate ? `${anchorDate}T00:00` : '',
    endAt: anchorDate ? `${anchorDate}T23:59` : '',
    minDate: operationStart ?? undefined,
    maxDate: operationEnd ?? undefined,
    startInputId: 'milestone-start',
    endInputId: 'milestone-due',
    onStartAtChange: () => undefined,
    onEndAtChange: () => undefined,
  };

  return (
    <FormSection
      title="마일스톤 일정"
      description="운영 기간에서 시작일과 종료일을 선택하세요."
    >
      {operationStart && operationEnd ? (
        <ProgramScheduleRangeCalendar
          events={events}
          activeRange={activeRange}
          monthKey={monthKey}
          focusedDate={focusedDate}
          onMonthKeyChange={setMonthKey}
          onFocusedDateChange={setFocusedDate}
          onDateSelect={selectDate}
        />
      ) : (
        <p className="rounded-card border border-dashed border-border p-card text-small text-muted-foreground">
          운영 기간을 먼저 입력해 주세요.
        </p>
      )}
      <section className="mt-6 grid gap-4" aria-label="마일스톤 목록">
        <div className="flex items-center justify-between gap-4">
          <h2 className="font-semibold">마일스톤 목록</h2>
          <Button
            type="button"
            disabled={!operationStart || !operationEnd}
            onClick={() => startDraft()}
          >
            마일스톤 추가
          </Button>
        </div>
        <FieldError>
          {issues.find((issue) => issue.path === 'milestones')?.message}
        </FieldError>
        {visibleMilestones.length === 0 ? (
          <p className="text-small text-muted-foreground">
            추가된 마일스톤이 없습니다.
          </p>
        ) : (
          visibleMilestones.map((item) => (
            <Card key={item.id}>
              <CardHeader className="relative gap-2">
                <div className="pr-20">
                  <CardTitle className="text-lg">
                    {item.name || '이름 없는 마일스톤'}
                  </CardTitle>
                  <p className="mt-1 text-small text-muted-foreground">
                    {rangeLabel(item)}
                  </p>
                </div>
                <CardAction
                  className="absolute top-0 flex gap-1"
                  style={{ right: 'var(--card-spacing)' }}
                >
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`${item.name} 수정`}
                    title="수정"
                    onClick={() => {
                      onMilestoneEditStart(item);
                      setEditing({
                        id: item.id,
                        snapshot: item,
                        showValidation: false,
                      });
                    }}
                  >
                    <Pencil aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`${item.name} 삭제`}
                    title="삭제"
                    onClick={() => onMilestoneCancel(item.id, null)}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent className="grid gap-3">
                {item.instructions ? (
                  <div className="grid gap-1">
                    <p className="text-xs font-semibold text-muted-foreground">
                      공지사항
                    </p>
                    <p className="whitespace-pre-wrap text-small">
                      {item.instructions}
                    </p>
                  </div>
                ) : null}
                {item.requirements.length > 0 ? (
                  <div className="grid gap-1">
                    <p className="text-xs font-semibold text-muted-foreground">
                      첨부파일
                    </p>
                    {item.requirements.map((requirement) => (
                      <p
                        key={requirement.id}
                        className="text-small text-muted-foreground"
                      >
                        {requirement.name} ·{' '}
                        {requirement.required ? '필수' : '선택'}
                      </p>
                    ))}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))
        )}
      </section>
      {milestone && editing ? (
        <ProgramAuthoringMilestoneDialog
          milestone={milestone}
          operationStartAt={state.operationStartAt}
          operationEndAt={state.operationEndAt}
          isNew={editing.snapshot === null}
          initialValidationVisible={editing.showValidation}
          onFieldChange={(field, value) =>
            dispatch({
              type: 'set_milestone_field',
              milestoneId: milestone.id,
              field,
              value,
            })
          }
          onAddAttachment={(file) => {
            const requirementId = newId();
            dispatch({
              type: 'add_requirement',
              milestoneId: milestone.id,
              requirementId,
            });
            onRequirementFileChange(milestone.id, requirementId, file);
          }}
          onAttachmentFileChange={(requirementId, file) =>
            onRequirementFileChange(milestone.id, requirementId, file)
          }
          onAttachmentRemove={(requirementId) =>
            onRequirementRemove(milestone.id, requirementId)
          }
          onAttachmentRequiredChange={(requirementId, required) =>
            dispatch({
              type: 'set_requirement_required',
              milestoneId: milestone.id,
              requirementId,
              required,
            })
          }
          onAttachmentReorder={(requirementIds) =>
            dispatch({
              type: 'reorder_requirements',
              milestoneId: milestone.id,
              requirementIds,
            })
          }
          onAttachmentNameChange={(requirementId, name) =>
            dispatch({
              type: 'set_requirement_name',
              milestoneId: milestone.id,
              requirementId,
              name,
            })
          }
          onCancel={cancel}
          onSave={() => {
            onMilestoneSave(milestone.id);
            setEditing(null);
          }}
        />
      ) : null}
    </FormSection>
  );
}

function rangeLabel(milestone: ProgramAuthoringMilestone): string {
  const start = dateKey(milestone.startAt);
  const due = dateKey(milestone.dueAt);
  return start && due
    ? `${formatKoreanDate(start)} ~ ${formatKoreanDate(due)}`
    : '기간 미정';
}

function milestoneForIssues(
  milestones: readonly ProgramAuthoringMilestone[],
  issues: readonly ProgramAuthoringIssue[],
): ProgramAuthoringMilestone | undefined {
  for (const issue of issues) {
    const milestoneId = /^milestones\.([^.]+)\./.exec(issue.path)?.[1];
    if (milestoneId !== undefined) {
      const milestone = milestones.find(({ id }) => id === milestoneId);
      if (milestone !== undefined) return milestone;
    }
    const requirementId = /^requirements\.([^.]+)/.exec(issue.path)?.[1];
    if (requirementId !== undefined) {
      const milestone = milestones.find(({ requirements }) =>
        requirements.some(({ id }) => id === requirementId),
      );
      if (milestone !== undefined) return milestone;
    }
  }
  return undefined;
}
