import type { NavItem } from '@/components';
import type { ShellIconName } from './shell-icons';
import {
  menuIconFor,
  shellSectionFromPathname,
  type ShellSection,
} from './sidebar-menu';
import type { ShellSession } from './sidebar-presence';

export type SectionId = Exclude<ShellSection, null>;

export interface SectionItem extends NavItem {
  readonly id: SectionId;
  readonly icon: ShellIconName;
}

function section(id: SectionId, label: string, href: string): SectionItem {
  return { id, label, href, icon: menuIconFor(href) };
}

export const SECTIONS: readonly SectionItem[] = [
  section('programs', '프로그램', '/programs'),
  section('archive', '공개 아카이브', '/archive'),
  section('ranking', '랭킹', '/ranking'),
];

const DASHBOARD_SECTION: SectionItem = section(
  'dashboard',
  '대시보드',
  '/dashboard',
);

export function sectionItemsFor(
  session: Pick<ShellSession, 'status' | 'isProfileComplete'>,
): readonly SectionItem[] {
  if (session.status !== 'assigned' || !session.isProfileComplete) {
    return SECTIONS;
  }
  return [...SECTIONS, DASHBOARD_SECTION];
}

export function isCurrentSection(
  pathname: string,
  sectionId: SectionId,
): boolean {
  return shellSectionFromPathname(pathname) === sectionId;
}
