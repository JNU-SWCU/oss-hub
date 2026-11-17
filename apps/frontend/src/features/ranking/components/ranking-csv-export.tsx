'use client';

import { createContext, useContext } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface RankingCsvExport {
  readonly onExport: () => void;
  readonly isExporting: boolean;
}

export const RankingCsvExportContext = createContext<RankingCsvExport | null>(
  null,
);

export function RankingCsvExportButton() {
  const csvExport = useContext(RankingCsvExportContext);
  if (csvExport === null) return null;
  return (
    <Button
      type="button"
      variant="outline"
      onClick={csvExport.onExport}
      disabled={csvExport.isExporting}
    >
      <Download data-icon="inline-start" />
      CSV 다운로드
    </Button>
  );
}
