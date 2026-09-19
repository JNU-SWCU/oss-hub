import { Pencil, Trash2 } from 'lucide-react';
import { RowActions } from '@/components';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

export function ProgramMilestoneCard({
  name,
  id,
  period,
  notice,
  children,
  disabled = false,
  onEdit,
  onDelete,
}: {
  readonly name: string;
  readonly id?: string;
  /** 기간 한 줄 — `formatSeoulShortRange`가 만든 「26.08.05 – 26.08.06 01:58」 */
  readonly period: string;
  readonly notice: string | null;
  readonly children: React.ReactNode;
  readonly disabled?: boolean;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
}) {
  return (
    <TooltipProvider delayDuration={200}>
      <Card data-canonical-id={id}>
        <CardHeader className="relative gap-2">
          <div className="pr-24">
            <CardTitle className="text-lg">{name}</CardTitle>
            <p className="mt-1 text-small text-muted-foreground">
              <span className="sr-only">기간 </span>
              {period}
            </p>
          </div>
          <CardAction
            className="absolute top-0"
            style={{ right: 'var(--card-spacing)' }}
          >
            <RowActions>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={disabled}
                    aria-label={`${name} 수정`}
                    onClick={onEdit}
                  >
                    <Pencil aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{`${name} 수정`}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={disabled}
                    aria-label={`${name} 삭제`}
                    onClick={onDelete}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{`${name} 삭제`}</TooltipContent>
              </Tooltip>
            </RowActions>
          </CardAction>
        </CardHeader>
        <CardContent className="grid gap-3">
          {notice ? (
            <div className="grid gap-1">
              <p className="text-xs font-semibold text-muted-foreground">
                운영자 공지
              </p>
              <p className="whitespace-pre-wrap text-small">{notice}</p>
            </div>
          ) : null}
          {children}
        </CardContent>
      </Card>
    </TooltipProvider>
  );
}
