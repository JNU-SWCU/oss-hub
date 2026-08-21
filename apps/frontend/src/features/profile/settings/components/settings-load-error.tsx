import { PageBody } from '@/components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

export function SettingsLoadError({
  message,
  onRetry,
}: {
  readonly message: string;
  readonly onRetry: () => void;
}) {
  return (
    <PageBody className="max-w-2xl">
      <Alert variant="destructive">
        <AlertTitle>설정을 불러오지 못했습니다</AlertTitle>
        <AlertDescription className="flex flex-col items-start gap-4">
          <span>{message}</span>
          <Button type="button" variant="outline" onClick={onRetry}>
            다시 시도
          </Button>
        </AlertDescription>
      </Alert>
    </PageBody>
  );
}
