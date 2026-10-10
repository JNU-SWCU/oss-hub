import type {
  ApplicationStatus,
  ProgramLifecycle,
  ProgramTrackType,
} from '@prisma/client';

export type ProgramListRecord = {
  readonly id: string;
  readonly name: string;
  readonly organizer: string;
  readonly trackType: ProgramTrackType | null;
  readonly applicationTemplateKey: string;
  readonly lifecycle: ProgramLifecycle;
  readonly applicationStartAt: Date;
  readonly applicationEndAt: Date;
  readonly endAt: Date;
  readonly description: string;
  readonly teamMinSize: number;
  readonly teamMaxSize: number;
  readonly coverId?: string | null;
  readonly coverExternalImageUrl?: string | null;
};

export interface ProgramListItemNote {
  readonly text: string;
  readonly icon?: 'team';
}

export interface PersonalizedProgramListItem extends ProgramListRecord {
  readonly note?: ProgramListItemNote;

  readonly viewerApplicationStatus?: ApplicationStatus;

  readonly applicationCount?: number;

  readonly pendingApplicationCount?: number;
}

export interface ProgramListPage {
  readonly items: readonly PersonalizedProgramListItem[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;
}
