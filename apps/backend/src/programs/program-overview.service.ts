import type { AuthorityLabel } from '../users/authority-label.types';
import { Injectable } from '@nestjs/common';
import { DomainException } from '../platform/error-code.error';
import {
  PROGRAM_OVERVIEW_ERROR_CODES,
  ProgramOverviewErrorCode,
} from './program-overview-error-code.error';
import {
  MilestoneDocumentCatalogEntry,
  MilestoneSchedule,
  ProgramOverviewRepository,
  ProgramOverviewRecord,
  type PublicTeamRow,
} from './program-overview.repository';
import { UserProfileService } from '../users/user-profile.service';

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
  constructor(
    private readonly repository: ProgramOverviewRepository,
    private readonly userProfileService: UserProfileService,
  ) {}

  getOverviewFromRequest(
    programId: string,
    viewerGithubId: bigint,
    request: { readonly view?: string },
  ): Promise<ProgramOverviewView> {
    return this.getOverview(
      programId,
      viewerGithubId,
      request.view === 'operations',
    );
  }

  async getOverview(
    programId: string,
    viewerGithubId: bigint,
    operationsView = false,
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
      this.resolveViewerStats(
        programId,
        viewerGithubId,
        overview.teamCount,
        operationsView,
      ),
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
    operationsView: boolean,
  ): Promise<ProgramOverviewViewerStats> {
    const viewer = await this.repository.findViewerIdentity(viewerGithubId);
    const identity = viewer && {
      ...viewer,
      role: this.userProfileService.authorityLabel(viewer),
    };
    if (!identity || identity.role === null) {
      return { ...EMPTY_VIEWER_STATS, role: identity?.role ?? null };
    }

    if (
      identity.role === 'STUDENT' ||
      (!operationsView &&
        identity.memberKind === 'STUDENT' &&
        (await this.repository.findApprovedViewerApplicationId(
          programId,
          identity.userId,
        )) !== null)
    ) {
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
      this.countFullySubmittedParticipants(
        programId,
        milestone.requiredDocumentIds,
      ),
      this.repository.findMilestoneDocumentCatalog(programId),
    ]);
    const withDocuments = documentedCatalog(catalog);
    const completedByMilestone = await this.countFullySubmittedTeamsByMilestone(
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

  private async countFullySubmittedParticipants(
    programId: string,
    requiredDocumentIds: string[],
  ): Promise<number> {
    const applications =
      await this.repository.findProgramApplications(programId);
    if (applications.length === 0) {
      return 0;
    }
    const submitted = await this.submittedDocumentIdsByApplication(
      applications,
      requiredDocumentIds,
    );
    const memberCountByTeam = await this.repository.countTeamMembers(
      programId,
      applications
        .map((application) => application.teamId)
        .filter((teamId): teamId is string => teamId !== null),
    );
    return applications
      .filter((application) =>
        this.hasAllRequiredDocuments(
          submitted.get(application.id),
          requiredDocumentIds,
        ),
      )
      .reduce(
        (total, application) =>
          total +
          (application.teamId
            ? (memberCountByTeam.get(application.teamId) ?? 0)
            : 1),
        0,
      );
  }

  private async countFullySubmittedTeamsByMilestone(
    programId: string,
    milestones: readonly {
      milestoneId: string;
      requiredDocumentIds: string[];
    }[],
  ): Promise<Map<string, number>> {
    if (milestones.length === 0) {
      return new Map();
    }
    const applications =
      await this.repository.findProgramApplications(programId);
    if (applications.length === 0) {
      return new Map(milestones.map((milestone) => [milestone.milestoneId, 0]));
    }
    const submitted = await this.submittedDocumentIdsByApplication(
      applications,
      [
        ...new Set(
          milestones.flatMap((milestone) => milestone.requiredDocumentIds),
        ),
      ],
    );
    const result = new Map<string, number>();
    for (const milestone of milestones) {
      const completedTeamIds = new Set<string>();
      for (const application of applications) {
        if (
          this.hasAllRequiredDocuments(
            submitted.get(application.id),
            milestone.requiredDocumentIds,
          )
        ) {
          completedTeamIds.add(
            application.teamId ?? `application:${application.id}`,
          );
        }
      }
      result.set(milestone.milestoneId, completedTeamIds.size);
    }
    return result;
  }

  private async submittedDocumentIdsByApplication(
    applications: readonly { readonly id: string }[],
    documentIds: readonly string[],
  ): Promise<Map<string, Set<string>>> {
    const rows = await this.repository.findSubmittedDocumentPairs(
      applications.map((application) => application.id),
      [...new Set(documentIds)],
    );
    const byApplication = new Map<string, Set<string>>();
    for (const row of rows) {
      const set = byApplication.get(row.applicationId) ?? new Set<string>();
      set.add(row.milestoneDocumentId);
      byApplication.set(row.applicationId, set);
    }
    return byApplication;
  }

  private hasAllRequiredDocuments(
    submitted: Set<string> | undefined,
    requiredDocumentIds: readonly string[],
  ): boolean {
    if (requiredDocumentIds.length === 0) {
      return true;
    }
    if (!submitted) {
      return false;
    }
    return requiredDocumentIds.every((documentId) => submitted.has(documentId));
  }
}
