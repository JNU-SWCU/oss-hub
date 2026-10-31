'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

interface RankingCycleContextValue {
  readonly nextCycleAt: string | null;

  readonly reported: boolean;
  readonly setNextCycleAt: (nextCycleAt: string | null) => void;
}

const RankingCycleContext = createContext<RankingCycleContextValue | null>(
  null,
);

export function RankingCycleProvider({
  children,
  initialNextCycleAt,
}: {
  readonly children: ReactNode;
  readonly initialNextCycleAt?: string | null;
}) {
  const [nextCycleAt, setNextCycleAtState] = useState<
    string | null | undefined
  >(initialNextCycleAt);
  const setNextCycleAt = useCallback((value: string | null) => {
    setNextCycleAtState(value);
  }, []);
  const value = useMemo(
    () => ({
      nextCycleAt: nextCycleAt ?? null,
      reported: nextCycleAt !== undefined,
      setNextCycleAt,
    }),
    [nextCycleAt, setNextCycleAt],
  );
  return (
    <RankingCycleContext.Provider value={value}>
      {children}
    </RankingCycleContext.Provider>
  );
}

export function useRankingCycle(): RankingCycleContextValue {
  const value = useContext(RankingCycleContext);
  if (value === null) {
    throw new Error(
      'useRankingCycle requires RankingCycleProvider — ProductShell owns the ranking cycle clock.',
    );
  }
  return value;
}

export function useOptionalRankingNextCycleAt(): string | null {
  return useContext(RankingCycleContext)?.nextCycleAt ?? null;
}

export function useOptionalRankingCycleReported(): boolean {
  return useContext(RankingCycleContext)?.reported ?? true;
}
