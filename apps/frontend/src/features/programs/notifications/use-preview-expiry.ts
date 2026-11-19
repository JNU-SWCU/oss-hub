import { useEffect } from 'react';

export function usePreviewExpiry(
  expiresAt: string | undefined,
  onExpire: () => void,
) {
  const deadline = expiresAt === undefined ? undefined : Date.parse(expiresAt);
  useEffect(() => {
    if (deadline === undefined) return;
    const remaining = deadline - Date.now();
    if (!(remaining > 0)) {
      onExpire();
      return;
    }
    const timer = setTimeout(onExpire, remaining);
    return () => clearTimeout(timer);
  }, [deadline, onExpire]);

  return function expireIfDue() {
    if (deadline === undefined || deadline > Date.now()) return false;
    onExpire();
    return true;
  };
}
