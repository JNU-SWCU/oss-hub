import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

type ProgramApplicationPeriodFieldProps = {
  startAt: string;
  endAt: string;
  error?: string;
  onStartAtChange: (value: string) => void;
  onEndAtChange: (value: string) => void;
};

export function ProgramApplicationPeriodField({
  startAt,
  endAt,
  error,
  onStartAtChange,
  onEndAtChange,
}: ProgramApplicationPeriodFieldProps) {
  return (
    <Field>
      <FieldLabel>신청 기간 *</FieldLabel>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-2">
          <FieldLabel className="text-xs" htmlFor="applicationStartAt">
            시작일시
          </FieldLabel>
          <Input
            id="applicationStartAt"
            type="datetime-local"
            value={startAt}
            onChange={(event) => onStartAtChange(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <FieldLabel className="text-xs" htmlFor="applicationEndAt">
            마감일시
          </FieldLabel>
          <Input
            id="applicationEndAt"
            type="datetime-local"
            value={endAt}
            onChange={(event) => onEndAtChange(event.target.value)}
          />
        </div>
      </div>
      <FieldError>{error}</FieldError>
    </Field>
  );
}
