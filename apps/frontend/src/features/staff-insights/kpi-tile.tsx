import type { ReactElement } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export function KpiTile({
  label,
  value,
  ratio,
  note,
}: {
  readonly label: string;
  readonly value: string;
  readonly ratio?: string;
  readonly note?: string;
}): ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardDescription className="break-keep">{label}</CardDescription>
        <CardTitle className="text-2xl font-semibold tabular-nums">
          {value}
        </CardTitle>
      </CardHeader>
      {ratio === undefined && note === undefined ? null : (
        <CardContent className="space-y-2">
          {ratio === undefined ? null : (
            <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground tabular-nums">
              {ratio}
            </span>
          )}
          {note === undefined ? null : (
            <p className="break-keep text-xs text-muted-foreground">{note}</p>
          )}
        </CardContent>
      )}
    </Card>
  );
}
