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
import { SHELL_BREAKPOINT_PX } from './shell-breakpoint';
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
  return (
    target.closest('input, textarea, select, [contenteditable="true"]') !== null
  );
}

function desktopSidebarVisible(): boolean {
  const aside = document.getElementById(SIDEBAR_ASIDE_ID);
  return aside !== null && getComputedStyle(aside).display !== 'none';
}

interface ShellMenuContextValue {
  readonly sheetOpen: boolean;
  readonly openSheet: () => void;
  readonly closeSheet: () => void;

  readonly collapsed: boolean;
  readonly toggleCollapsed: () => void;

  readonly sidebarAvailable: boolean;

  readonly sheetAvailable: boolean;
}

const ShellMenuContext = createContext<ShellMenuContextValue | null>(null);

export function ShellMenuProvider({
  children,
  initialCollapsed = false,
  sidebarAvailable = false,
  sheetAvailable = false,
}: {
  readonly children: ReactNode;
  readonly initialCollapsed?: boolean;
  readonly sidebarAvailable?: boolean;

  readonly sheetAvailable?: boolean;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const openSheet = useCallback(() => setSheetOpen(true), []);
  const closeSheet = useCallback(() => setSheetOpen(false), []);
  const toggleCollapsed = useCallback(
    () => setCollapsed((current) => !current),
    [],
  );

  useEffect(() => {
    if (!sidebarAvailable) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        sheetOpen ||
        !isSidebarShortcut(event) ||
        isTypingTarget(event.target)
      ) {
        return;
      }
      event.preventDefault();
      if (desktopSidebarVisible()) toggleCollapsed();
      else if (sheetAvailable) openSheet();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [sidebarAvailable, sheetAvailable, sheetOpen, openSheet, toggleCollapsed]);

  useEffect(() => {
    if (!sheetOpen) return;
    const desktop = window.matchMedia(`(min-width: ${SHELL_BREAKPOINT_PX}px)`);
    const onChange = (event: MediaQueryListEvent) => {
      if (event.matches) closeSheet();
    };
    desktop.addEventListener('change', onChange);
    return () => desktop.removeEventListener('change', onChange);
  }, [sheetOpen, closeSheet]);

  useEffect(() => {
    document.cookie = `${SIDEBAR_STORAGE_KEY}=${
      collapsed ? SIDEBAR_COLLAPSED_VALUE : SIDEBAR_OPEN_VALUE
    }; Path=/; Max-Age=31536000; SameSite=Lax`;
  }, [collapsed]);

  const value = useMemo(
    () => ({
      sheetOpen,
      openSheet,
      closeSheet,
      collapsed,
      toggleCollapsed,
      sidebarAvailable,
      sheetAvailable,
    }),
    [
      sheetOpen,
      openSheet,
      closeSheet,
      collapsed,
      toggleCollapsed,
      sidebarAvailable,
      sheetAvailable,
    ],
  );
  return (
    <ShellMenuContext.Provider value={value}>
      {children}
    </ShellMenuContext.Provider>
  );
}

export function useShellMenu(): ShellMenuContextValue | null {
  return useContext(ShellMenuContext);
}
