'use client';

import { createContext, useContext } from 'react';
import type { ShellSection, SidebarGroup } from './sidebar-menu';
import type { ShellDataStatus } from './use-product-shell-data';

export interface ShellFacets {
  readonly section: ShellSection;
  readonly groups: readonly SidebarGroup[];
  readonly facetStatus: ShellDataStatus;
  readonly pathname: string;
  readonly search: string;
}

export const ShellFacetsContext = createContext<ShellFacets | null>(null);

export function useShellFacets(): ShellFacets | null {
  return useContext(ShellFacetsContext);
}
