import type { ProgramCategory } from './program-templates';

export const PROGRAM_PARTICIPATION_TYPES = ['individual', 'team'] as const;
export type ProgramParticipation = (typeof PROGRAM_PARTICIPATION_TYPES)[number];

export interface ApplicationFormTemplate {
  readonly key: string;
  readonly version: number;
  readonly name: string;
  readonly participation: ProgramParticipation;
}

export interface ProgramListItem {
  readonly id: string;
  readonly name: string;
  readonly organizer: string;
  readonly category: ProgramCategory;
  readonly applicationStartAt: string;
  readonly applicationEndAt: string;
  readonly description: string;
}

export const PROGRAM_LIST_STATUSES = ['all', 'recruiting', 'closed'] as const;
export type ProgramListStatus = (typeof PROGRAM_LIST_STATUSES)[number];

export interface ProgramListParams {
  readonly page: number;
  readonly pageSize: number;
  readonly search: string;
  readonly status: ProgramListStatus;
}

export interface ProgramListPage {
  readonly items: readonly ProgramListItem[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;
}
