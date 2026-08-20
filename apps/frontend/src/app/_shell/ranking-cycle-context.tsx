'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/**
 * nextCycleAt from the ranking page fetch. ProductShell must not GET /ranking.
 * RankingScreen publishes after its list request; the sidebar only reads.
 */
interface RankingCycleContextValue {
  readonly nextCycleAt: string | null;
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
  const [nextCycleAt, setNextCycleAtState] = useState<string | null>(
    initialNextCycleAt === undefined ? null : initialNextCycleAt,
  );
  const setNextCycleAt = useCallback((value: string | null) => {
    setNextCycleAtState(value);
  }, []);
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

/** Safe read for AppSidebar tests that render without the provider. */
export function useOptionalRankingNextCycleAt(): string | null {
  return useContext(RankingCycleContext)?.nextCycleAt ?? null;
}
