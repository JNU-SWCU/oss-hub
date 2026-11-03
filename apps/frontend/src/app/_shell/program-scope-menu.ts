import { programDocumentsHref, programMyTeamHref } from '@/lib/program-route';
import { programHref } from '@/features/programs/program-paths';
import type { ShellIconName } from './shell-icons';

export interface ProgramScopeSidebarItem {
  readonly label: string;
  readonly isViewSwitch?: {
    readonly programId: string;
    readonly operationsView: boolean;
  };
  readonly href: string;
  readonly icon: ShellIconName;
  readonly depth?: 0 | 1;

  readonly count?: string;
}

export interface ProgramScopeSidebarGroup {
  readonly label: string;
  readonly items: readonly ProgramScopeSidebarItem[];
}

export type ProgramScopeViewerRole = 'GUEST' | 'STUDENT' | 'STAFF' | 'ADMIN';

export function programScopeBackHref(): string {
  return '/programs';
}

interface ProgramScopeMilestoneDocsSummary {
  readonly milestoneId: string;
  readonly title: string;

  readonly completed: number;

  readonly total: number;
}

interface ProgramScopeMilestoneNavigation {
  readonly milestoneId: string;
  readonly title: string;

  readonly submissionEnabled: boolean;
}

export interface ProgramScopeSidebarInput {
  readonly programId: string;
  readonly viewerRole: ProgramScopeViewerRole;
  readonly teamCount: number;
  readonly boardPostCount: number;

  readonly viewerDocuments?: {
    readonly completed: number;
    readonly total: number;
  };

  readonly viewerParticipant?: boolean;
  readonly canSwitchView?: boolean;
  readonly operationsView?: boolean;

  readonly viewerHasAdminAccess?: boolean;

  readonly milestones?: readonly ProgramScopeMilestoneNavigation[];

  readonly milestoneDocuments?: readonly ProgramScopeMilestoneDocsSummary[];
}

export function programScopeSidebarGroups(
  input: ProgramScopeSidebarInput,
): readonly ProgramScopeSidebarGroup[] {
  const {
    programId,
    viewerRole,
    teamCount,
    boardPostCount,
    viewerDocuments,
    viewerParticipant,
    milestones,
    milestoneDocuments = [],
  } = input;

  if (viewerRole !== 'STUDENT' && viewerRole !== 'STAFF') {
    return [
      {
        label: '프로그램',
        items: [
          {
            label: '프로그램 개요',
            href: programHref(programId),
            icon: 'home',
            depth: 0,
          },
        ],
      },
    ];
  }

  const isStaffView = viewerRole === 'STAFF';

  const overviewItems: ProgramScopeSidebarItem[] = [
    {
      label: '프로그램 개요',
      href: programHref(programId),
      icon: 'home',
      depth: 0,
    },
  ];

  if (viewerRole === 'STUDENT') {
    overviewItems.push({
      label: '우리 팀',
      href: programMyTeamHref(programId),

      icon: 'building',
      depth: 0,
    });
  }

  overviewItems.push({
    label: isStaffView ? '팀 관리' : '참여 팀',
    href: programHref(programId, '/teams'),
    icon: 'people',
    depth: 0,
    count: String(teamCount),
  });

  const overviewGroup: ProgramScopeSidebarGroup = {
    label: '프로그램',
    items: overviewItems,
  };

  const notParticipantStudent =
    viewerRole === 'STUDENT' && viewerParticipant === false;

  const documentsLocked = notParticipantStudent;

  const boardLocked = notParticipantStudent;

  const fallbackMilestones: readonly ProgramScopeMilestoneNavigation[] =
    milestoneDocuments.map((milestone) => ({
      milestoneId: milestone.milestoneId,
      title: milestone.title,
      submissionEnabled: true,
    }));
  const navigationMilestones = (
    milestones ?? (isStaffView ? fallbackMilestones : [])
  ).filter((milestone) => isStaffView || milestone.submissionEnabled);
  const documentSummaryByMilestone = new Map(
    milestoneDocuments.map((milestone) => [milestone.milestoneId, milestone]),
  );

  const documentsParent: ProgramScopeSidebarItem = isStaffView
    ? {
        label: '서류 현황',
        href: programDocumentsHref(programId),
        icon: 'inbox',
        depth: 0,
      }
    : {
        label: '내 제출물',
        href: programDocumentsHref(programId),
        icon: 'inbox',
        depth: 0,
        count: viewerDocuments
          ? `${viewerDocuments.completed}/${viewerDocuments.total}`
          : undefined,
      };

  const allStagesItem: readonly ProgramScopeSidebarItem[] =
    isStaffView && navigationMilestones.length > 0
      ? [
          {
            label: '모든 단계',
            href: programDocumentsHref(programId),
            icon: 'inbox',
            depth: 1,
            count: `${teamCount}팀`,
          },
        ]
      : [];
  const milestoneItems: readonly ProgramScopeSidebarItem[] =
    navigationMilestones.map((milestone) => {
      const summary = documentSummaryByMilestone.get(milestone.milestoneId);
      return {
        label: milestone.title,
        href: programDocumentsHref(programId, milestone.milestoneId),
        icon: 'inbox',
        depth: 1,
        count: summary
          ? isStaffView
            ? `${summary.completed}/${teamCount}팀`
            : `${summary.completed}/${summary.total}`
          : undefined,
      };
    });
  const documentsChildren = [...allStagesItem, ...milestoneItems];

  const documentsGroup: ProgramScopeSidebarGroup = {
    label: documentsParent.label,
    items: [documentsParent, ...documentsChildren],
  };

  const boardGroup: ProgramScopeSidebarGroup = {
    label: '게시판',
    items: [
      {
        label: '게시판',
        href: programHref(programId, '/board'),
        icon: 'megaphone',
        depth: 0,
        count: String(boardPostCount),
      },
    ],
  };

  const groups = [
    overviewGroup,
    ...(documentsLocked ? [] : [documentsGroup]),
    ...(boardLocked ? [] : [boardGroup]),
  ];
  return groups;
}
