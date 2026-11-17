import { Info } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { RankingCsvExportButton } from './ranking-csv-export';

export function RankingPageHeader() {
  return (
    <PageHeader
      title="랭킹"
      description={
        <span className="inline-flex items-center gap-1">
          올해 GitHub에서 활동한 만큼 점수가 쌓입니다.
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="점수 계산 방법"
                  className="size-6"
                >
                  <Info className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent
                collisionPadding={16}
                className="max-w-(--radix-tooltip-content-available-width) break-keep text-pretty"
              >
                <span className="inline-block">
                  커밋·PR·이슈·저장소·스타를 모두 합산합니다.
                </span>{' '}
                <span className="inline-block">
                  스타는 올해 직접 커밋·PR한 공개 저장소의 것만 인정됩니다.
                </span>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </span>
      }
      actions={<RankingCsvExportButton />}
    />
  );
}
