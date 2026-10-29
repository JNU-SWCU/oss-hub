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
import { SIDEBAR_ASIDE_ID } from './sidebar-shell';

export const SIDEBAR_KEY_SHORTCUTS = 'Meta+Backslash Control+Backslash';

function isSidebarShortcut(event: KeyboardEvent): boolean {
  if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) {
    return false;
  }
  return event.code === 'Backslash' || event.key === '\\';
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return target.closest('input, textarea, select, [contenteditable="true"]') !== null;
}

function desktopSidebarVisible(): boolean {
  const aside = document.getElementById(SIDEBAR_ASIDE_ID);
  return aside !== null && getComputedStyle(aside).display !== 'none';
}

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
    if (!sidebarAvailable) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (open || !isSidebarShortcut(event) || isTypingTarget(event.target)) {
        return;
      }
      event.preventDefault();
      if (desktopSidebarVisible()) toggleCollapsed();
      else toggle();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [sidebarAvailable, open, toggle, toggleCollapsed]);

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
