import {
  Check,
  Clock,
  LoaderCircle,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { PROVISIONING_LABELS } from '../applications/application-presentation';
import type { ProgramTeam } from './dto';

type ProvisioningStatus = ProgramTeam['repositoryProvisioningStatus'];
type StepState = 'done' | 'current' | 'wait' | 'fail' | 'todo';

const CREATION_STATE: Readonly<
  Partial<Record<ProvisioningStatus, Exclude<StepState, 'todo'>>>
> = {
  PENDING: 'current',
  PROCESSING: 'current',
  FAILED_RETRYABLE: 'wait',
  FAILED_FINAL: 'fail',
  ANOMALOUS: 'fail',
  SUCCEEDED: 'done',
};

const STATE_ICON: Readonly<Record<StepState, LucideIcon | null>> = {
  done: Check,
  current: LoaderCircle,
  wait: Clock,
  fail: TriangleAlert,
  todo: null,
};

const CONTACT_STATUSES: readonly ProvisioningStatus[] = [
  'FAILED_FINAL',
  'ANOMALOUS',
];

function Step({
  label,
  state,
  stateLabel,
}: {
  readonly label: string;
  readonly state: StepState;
  readonly stateLabel?: string;
}) {
  const Icon = STATE_ICON[state];
  return (
    <li
      aria-current={
        state === 'current' || state === 'wait' || state === 'fail'
          ? 'step'
          : undefined
      }
      className="flex items-center gap-3 text-sm"
    >
      <span
        aria-hidden="true"
        className={cn(
          'flex size-6 shrink-0 items-center justify-center rounded-full border',
          state === 'done' &&
            'border-transparent bg-primary text-primary-foreground',
          state === 'current' && 'border-primary text-primary',
          state === 'wait' && 'border-border text-muted-foreground',
          state === 'fail' && 'border-destructive text-destructive',
          state === 'todo' && 'border-border',
        )}
      >
        {Icon ? (
          <Icon
            className={cn(
              'size-3.5',
              state === 'current' && 'animate-spin motion-reduce:animate-none',
            )}
          />
        ) : null}
      </span>
      <span className={cn(state === 'todo' && 'text-muted-foreground')}>
        {label}
      </span>
      {stateLabel ? (
        <span
          className={cn(
            'text-muted-foreground',
            state === 'fail' && 'text-destructive',
          )}
        >
          {stateLabel}
        </span>
      ) : null}
    </li>
  );
}

export function TeamRepositoryProvisioning({
  status,
}: {
  readonly status: ProvisioningStatus;
}) {
  const creation = CREATION_STATE[status];
  if (creation === undefined) return null;
  return (
    <div className="grid gap-2">
      <ol aria-label="저장소 발급 단계" className="grid gap-2">
        <Step label="신청 승인" state="done" />
        <Step
          label="저장소 생성"
          state={creation}
          stateLabel={
            status === 'SUCCEEDED' ? undefined : PROVISIONING_LABELS[status]
          }
        />
        <Step
          label="사용 가능"
          state={status === 'SUCCEEDED' ? 'done' : 'todo'}
        />
      </ol>
      {CONTACT_STATUSES.includes(status) ? (
        <p className="text-sm text-muted-foreground">운영진에게 문의하세요.</p>
      ) : null}
    </div>
  );
}
