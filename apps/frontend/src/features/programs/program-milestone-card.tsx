import { Pencil, Trash2 } from 'lucide-react';
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
  startAt,
  dueAt,
  notice,
  children,
  disabled = false,
  onEdit,
  onDelete,
}: {
  readonly name: string;
  readonly id?: string;
  readonly startAt: string;
  readonly dueAt: string;
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
            <dl className="mt-1 grid gap-1 text-small text-muted-foreground">
              <div>
                <dt className="inline font-semibold">시작 </dt>
                <dd className="inline">{startAt}</dd>
              </div>
              <div>
                <dt className="inline font-semibold">마감 </dt>
                <dd className="inline">{dueAt}</dd>
              </div>
            </dl>
          </div>
          <CardAction
            className="absolute top-0 flex gap-1"
            style={{ right: 'var(--card-spacing)' }}
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={`${name} 수정`}
                  className="inline-flex size-11 items-center justify-center rounded-control hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
                  onClick={onEdit}
                >
                  <Pencil aria-hidden="true" className="size-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{`${name} 수정`}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={`${name} 삭제`}
                  className="inline-flex size-11 items-center justify-center rounded-control hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
                  onClick={onDelete}
                >
                  <Trash2 aria-hidden="true" className="size-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{`${name} 삭제`}</TooltipContent>
            </Tooltip>
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
