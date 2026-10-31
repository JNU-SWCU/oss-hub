'use client';

import { useSearchParams } from 'next/navigation';

export function useShellUrlState() {
  return useSearchParams().toString();
}
