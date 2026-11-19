import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export const PREVIEW_EXPIRED = Symbol('preview expired');
export type MailDialogError = string | typeof PREVIEW_EXPIRED | null;

export function MailDialogErrorNotice({
  error,
  title,
}: {
  readonly error: MailDialogError;
  readonly title: string;
}) {
  if (error === null) return null;
  if (error === PREVIEW_EXPIRED)
    return (
      <p role="alert" className="text-small text-destructive">
        미리보기 만료: 새 미리보기가 필요합니다.
      </p>
    );
  return (
    <Alert variant="destructive">
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  );
}
