'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

interface ProgramNameReport {
  readonly programId: string;
  readonly name: string;
}

interface ProgramNameReportContextValue {
  readonly reported: ProgramNameReport | null;
  readonly reportProgramName: (programId: string, name: string) => void;
}

const ProgramNameReportContext =
  createContext<ProgramNameReportContextValue | null>(null);

export function ProgramNameReportProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const [reported, setReported] = useState<ProgramNameReport | null>(null);
  const reportProgramName = useCallback((programId: string, name: string) => {
    setReported((current) =>
      current?.programId === programId && current.name === name
        ? current
        : { programId, name },
    );
  }, []);
  const value = useMemo(
    () => ({ reported, reportProgramName }),
    [reported, reportProgramName],
  );
  return (
    <ProgramNameReportContext.Provider value={value}>
      {children}
    </ProgramNameReportContext.Provider>
  );
}

const noopReport = () => {};

export function useReportProgramName(): (
  programId: string,
  name: string,
) => void {
  return useContext(ProgramNameReportContext)?.reportProgramName ?? noopReport;
}

export function useReportedProgramName(
  programId: string | null,
): string | undefined {
  const reported = useContext(ProgramNameReportContext)?.reported ?? null;
  if (programId === null || reported === null) return undefined;
  return reported.programId === programId ? reported.name : undefined;
}
