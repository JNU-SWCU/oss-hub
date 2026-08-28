import type { ProgramScheduleEventKind } from './program-schedule-calendar-model';

export type ProgramScheduleEditableRange = {
  readonly id: string;
  readonly label: string;
  readonly kind: ProgramScheduleEventKind;
  readonly startAt: string;
  readonly endAt: string;
  readonly minDate?: string;
  readonly maxDate?: string;
  readonly startInputId: string;
  readonly endInputId: string;
  readonly startError?: string;
  readonly endError?: string;
  readonly endDisabled?: boolean;
  readonly onStartAtChange: (value: string) => void;
  readonly onEndAtChange: (value: string) => void;
};
