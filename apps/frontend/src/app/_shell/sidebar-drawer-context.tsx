'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

interface SidebarDrawerContextValue {
  readonly open: boolean;
  readonly toggle: () => void;
  readonly close: () => void;
}

const SidebarDrawerContext = createContext<SidebarDrawerContextValue | null>(
  null,
);

export function SidebarDrawerProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((current) => !current), []);
  const close = useCallback(() => setOpen(false), []);
  const value = useMemo(() => ({ open, toggle, close }), [open, toggle, close]);
  return (
    <SidebarDrawerContext.Provider value={value}>
      {children}
    </SidebarDrawerContext.Provider>
  );
}

export function useSidebarDrawer(): SidebarDrawerContextValue | null {
  return useContext(SidebarDrawerContext);
}
