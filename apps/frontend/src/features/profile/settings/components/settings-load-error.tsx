import { PageBody, FailureState } from '@/components';

export function SettingsLoadError({
  message,
  onRetry,
}: {
  readonly message: string;
  readonly onRetry: () => void;
}) {
  return (
    <PageBody className="max-w-2xl">
      <FailureState
        title="설정을 불러오지 못했습니다"
        description={message}
        onRetry={onRetry}
      />
    </PageBody>
  );
}
