'use client';

const listeners = new Set<() => void>();

export function subscribeSessionInvalidation(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function invalidateSession(): void {
  for (const listener of [...listeners]) listener();
}
