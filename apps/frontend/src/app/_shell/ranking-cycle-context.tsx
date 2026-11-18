'use client';

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

interface RankingCycleContextValue {
  readonly nextCycleAt: string | null | undefined;
  readonly setNextCycleAt: (nextCycleAt: string | null | undefined) => void;
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
  const [nextCycleAt, setNextCycleAt] = useState<string | null | undefined>(
    initialNextCycleAt,
  );
  const value = useMemo(
    () => ({ nextCycleAt, setNextCycleAt }),
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

export function useOptionalRankingNextCycleAt(): string | null | undefined {
  const cycle = useContext(RankingCycleContext);
  return cycle === null ? null : cycle.nextCycleAt;
}
