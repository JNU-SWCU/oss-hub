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
          올해 깃허브에 갈아 넣은 만큼 점수가 쌓여요.
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
              <TooltipContent>
                커밋·PR·이슈·레포·스타 전부 합산! 스타는 올해 내가 직접
                커밋·PR한 공개 레포 것만 인정돼요.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </span>
      }
      actions={<RankingCsvExportButton />}
    />
  );
}
