import { Injectable } from '@nestjs/common';
import type { AuthorityLabel } from '../../../users/domain/authority-label';
import { DomainException } from '../../../common/error-code';
import {
  PROGRAM_OVERVIEW_ERROR_CODES,
  ProgramOverviewErrorCode,
} from './program-overview-error-code.enum';
import {
  MilestoneDocumentCatalogEntry,
  MilestoneSchedule,
  ProgramOverviewRecord,
  ProgramOverviewRepository,
  PublicTeamRow,
} from './program-overview.repository';

export interface ProgramOverviewViewerStats {
  role: AuthorityLabel | null;
  myDocumentsCompleted: number | null;
  myDocumentsTotal: number | null;
  fullySubmittedParticipantCount: number | null;

  milestoneDocuments: ProgramOverviewMilestoneDocument[];
}

export interface ProgramOverviewMilestoneDocument {
  milestoneId: string;
  title: string;
  completed: number;
  total: number;
}

export interface ProgramOverviewRemainingMilestone {
  readonly label: string;
  readonly dueAt: Date;
}

export interface ProgramOverviewView extends ProgramOverviewRecord {
  viewer: ProgramOverviewViewerStats;
  remainingMilestones: readonly ProgramOverviewRemainingMilestone[];
}

const EMPTY_VIEWER_STATS: ProgramOverviewViewerStats = {
  role: null,
  myDocumentsCompleted: null,
  myDocumentsTotal: null,
  fullySubmittedParticipantCount: null,
  milestoneDocuments: [],
};

function remainingMilestones(
  schedules: readonly MilestoneSchedule[],
  now: Date,
): ProgramOverviewRemainingMilestone[] {
  return schedules
    .filter((schedule) => schedule.dueAt.getTime() > now.getTime())
    .toSorted((left, right) => left.dueAt.getTime() - right.dueAt.getTime())
    .map((schedule) => ({ label: schedule.label, dueAt: schedule.dueAt }));
}

function excludeEmptyDocumentEntries(
  entries: ProgramOverviewMilestoneDocument[],
): ProgramOverviewMilestoneDocument[] {
  return entries.filter((entry) => entry.total > 0);
}

function documentedCatalog(
  catalog: readonly MilestoneDocumentCatalogEntry[],
): MilestoneDocumentCatalogEntry[] {
  return catalog.filter((entry) => entry.documentIds.length > 0);
}

function sumStudentDocuments(
  catalog: readonly MilestoneDocumentCatalogEntry[],
  submittedDocumentIds: ReadonlySet<string>,
): { completed: number; total: number } {
  let completed = 0;
  let total = 0;
  for (const entry of documentedCatalog(catalog)) {
    total += entry.documentIds.length;
    completed += entry.documentIds.filter((id) =>
      submittedDocumentIds.has(id),
    ).length;
  }
  return { completed, total };
}

@Injectable()
export class ProgramOverviewService {
  constructor(private readonly repository: ProgramOverviewRepository) {}

  async getOverview(
    programId: string,
    viewerGithubId: bigint,
  ): Promise<ProgramOverviewView> {
    const overview = await this.repository.findByProgramId(programId);
    if (!overview) {
      throw new DomainException(
        PROGRAM_OVERVIEW_ERROR_CODES[
          ProgramOverviewErrorCode.PROGRAM_NOT_FOUND
        ],
      );
    }

    const [viewer, milestoneSchedules] = await Promise.all([
      this.resolveViewerStats(programId, viewerGithubId, overview.teamCount),
      this.repository.findMilestoneSchedules(programId),
    ]);
    return {
      ...overview,
      viewer,
      remainingMilestones: remainingMilestones(milestoneSchedules, new Date()),
    };
  }

  async getPublicTeams(programId: string): Promise<PublicTeamRow[]> {
    const exists = await this.repository.programExists(programId);
    if (!exists) {
      throw new DomainException(
        PROGRAM_OVERVIEW_ERROR_CODES[
          ProgramOverviewErrorCode.PROGRAM_NOT_FOUND
        ],
      );
    }
    return this.repository.listPublicTeams(programId);
  }

  private async resolveViewerStats(
    programId: string,
    viewerGithubId: bigint,
    teamCount: number,
  ): Promise<ProgramOverviewViewerStats> {
    const identity = await this.repository.findViewerIdentity(viewerGithubId);
    if (!identity || identity.role === null) {
      return { ...EMPTY_VIEWER_STATS, role: identity?.role ?? null };
    }

    if (identity.role === 'STUDENT') {
      return this.resolveStudentStats(programId, identity.userId);
    }
    if (identity.role === 'STAFF' || identity.role === 'ADMIN') {
      return this.resolveStaffStats(programId, identity.role, teamCount);
    }
    return { ...EMPTY_VIEWER_STATS, role: identity.role };
  }

  private async resolveStudentStats(
    programId: string,
    userId: string,
  ): Promise<ProgramOverviewViewerStats> {
    const hasDocuments = await this.repository.findCurrentSubmissionMilestone(
      programId,
      new Date(),
    );
    if (!hasDocuments) {
      return { ...EMPTY_VIEWER_STATS, role: 'STUDENT' };
    }

    const [applicationId, catalog] = await Promise.all([
      this.repository.findViewerApplicationId(programId, userId),
      this.repository.findMilestoneDocumentCatalog(programId),
    ]);
    const allDocumentIds = catalog.flatMap((entry) => entry.documentIds);
    const submittedDocumentIds = applicationId
      ? await this.repository.findSubmittedDocumentIds(
          applicationId,
          allDocumentIds,
        )
      : new Set<string>();
    const { completed, total } = sumStudentDocuments(
      catalog,
      submittedDocumentIds,
    );

    return {
      role: 'STUDENT',
      myDocumentsCompleted: completed,
      myDocumentsTotal: total,
      fullySubmittedParticipantCount: null,
      milestoneDocuments: excludeEmptyDocumentEntries(
        catalog.map((entry) => ({
          milestoneId: entry.milestoneId,
          title: entry.title,
          completed: entry.documentIds.filter((id) =>
            submittedDocumentIds.has(id),
          ).length,
          total: entry.documentIds.length,
        })),
      ),
    };
  }

  private async resolveStaffStats(
    programId: string,
    role: 'STAFF' | 'ADMIN',
    teamCount: number,
  ): Promise<ProgramOverviewViewerStats> {
    const milestone = await this.repository.findCurrentSubmissionMilestone(
      programId,
      new Date(),
    );
    if (!milestone) {
      return { ...EMPTY_VIEWER_STATS, role };
    }

    const [fullySubmittedParticipantCount, catalog] = await Promise.all([
      this.repository.countFullySubmittedParticipants(
        programId,
        milestone.requiredDocumentIds,
      ),
      this.repository.findMilestoneDocumentCatalog(programId),
    ]);
    const withDocuments = documentedCatalog(catalog);
    const completedByMilestone =
      await this.repository.countFullySubmittedTeamsByMilestone(
        programId,
        withDocuments,
      );

    return {
      role,
      myDocumentsCompleted: null,
      myDocumentsTotal: null,
      fullySubmittedParticipantCount,
      milestoneDocuments: withDocuments.map((entry) => ({
        milestoneId: entry.milestoneId,
        title: entry.title,
        completed: completedByMilestone.get(entry.milestoneId) ?? 0,

        total: teamCount,
      })),
    };
  }
}
