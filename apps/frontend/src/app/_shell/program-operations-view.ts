'use client';

import { useCallback, useSyncExternalStore } from 'react';

const memory = new Map<string, boolean>();
const failedWrites = new Set<string>();
const listeners = new Set<() => void>();

function storageKey(programId: string): string {
  return `oss-hub-program-operations-view:${programId}`;
}

function snapshot(programId: string | null): boolean {
  if (programId === null) return false;
  if (failedWrites.has(programId)) return memory.get(programId) ?? false;
  try {
    const value = sessionStorage.getItem(storageKey(programId)) === 'true';
    memory.set(programId, value);
    return value;
  } catch {
    return memory.get(programId) ?? false;
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function serverSnapshot(): null {
  return null;
}

export function useProgramOperationsView(
  programId: string | null,
): boolean | null {
  const getSnapshot = useCallback(() => snapshot(programId), [programId]);
  return useSyncExternalStore(subscribe, getSnapshot, serverSnapshot);
}

export function setProgramOperationsView(
  programId: string,
  value: boolean,
): void {
  memory.set(programId, value);
  try {
    sessionStorage.setItem(storageKey(programId), String(value));
    failedWrites.delete(programId);
  } catch {
    failedWrites.add(programId);
  }
  for (const listener of listeners) listener();
}
