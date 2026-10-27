'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  SIDEBAR_COLLAPSED_VALUE,
  SIDEBAR_OPEN_VALUE,
  SIDEBAR_STORAGE_KEY,
} from './sidebar-collapsed';

interface SidebarDrawerContextValue {
  readonly open: boolean;
  readonly toggle: () => void;
  readonly close: () => void;

  readonly collapsed: boolean;
  readonly toggleCollapsed: () => void;

  readonly sidebarAvailable: boolean;
}

const SidebarDrawerContext = createContext<SidebarDrawerContextValue | null>(
  null,
);

export function SidebarDrawerProvider({
  children,
  initialCollapsed = false,
  sidebarAvailable = false,
}: {
  readonly children: ReactNode;
  readonly initialCollapsed?: boolean;
  readonly sidebarAvailable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const toggle = useCallback(() => setOpen((current) => !current), []);
  const close = useCallback(() => setOpen(false), []);
  const toggleCollapsed = useCallback(
    () => setCollapsed((current) => !current),
    [],
  );

  useEffect(() => {
    document.cookie = `${SIDEBAR_STORAGE_KEY}=${
      collapsed ? SIDEBAR_COLLAPSED_VALUE : SIDEBAR_OPEN_VALUE
    }; Path=/; Max-Age=31536000; SameSite=Lax`;
  }, [collapsed]);

  const value = useMemo(
    () => ({
      open,
      toggle,
      close,
      collapsed,
      toggleCollapsed,
      sidebarAvailable,
    }),
    [open, toggle, close, collapsed, toggleCollapsed, sidebarAvailable],
  );
  return (
    <SidebarDrawerContext.Provider value={value}>
      {children}
    </SidebarDrawerContext.Provider>
  );
}

export function useSidebarDrawer(): SidebarDrawerContextValue | null {
  return useContext(SidebarDrawerContext);
}
