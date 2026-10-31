import { Injectable, Inject } from '@nestjs/common';
import { PublicEligibilityRepository } from './public-eligibility.repository';
import { DomainException } from '../platform/error-code.error';
import {
  PUBLIC_PROJECTS_ERROR_CODES,
  PublicProjectsErrorCode,
} from './public-projects-error-code.error';
import { PublicProjectMetricsRepository } from './public-project-metrics.repository';
import {
  PublicProjectsRepository,
  type PublicProjectRow,
  type PublicUserIdentity,
  type PublicProjectCursor,
  type PublicEligibilityInput,
} from './public-projects.repository';
import { PublicProjectApplicationMode } from './public-projects.config';
import type { RuntimeConfig } from '../platform/runtime-config.config';
import { RUNTIME_CONFIG } from '../platform/runtime-config-instance.config';
import { PublicProjectCursorSecretError } from './public-project-cursor.error';
import {
  hkdfSync,
  randomBytes,
  createCipheriv,
  createDecipheriv,
} from 'node:crypto';
import { RepositoryUrlService } from '../github/repository-url.service';

export interface PublicProjectListItem extends Omit<
  PublicProjectRow,
  'nameWithOwner'
> {
  readonly repositoryName: string;
  readonly githubUrl: string;
  readonly applicationMode: PublicProjectApplicationMode;
  readonly displayName: string;
}

export interface PublicProjectPageResult {
  readonly items: readonly PublicProjectListItem[];
  readonly pageSize: number;
  readonly nextPageId: string | null;
}

export interface PublicProjectMetrics {
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly releaseCount: number;
}

export interface PublicProjectContributor {
  readonly githubLogin: string;
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly releaseCount: number;
}

export interface PublicProjectDetailResult {
  readonly row: PublicProjectListItem;
  readonly metrics: PublicProjectMetrics;
  readonly contributors: readonly PublicProjectContributor[];
}

export interface PublicUserProfileProjectResult {
  readonly row: PublicProjectListItem;
  readonly observed: boolean;
  readonly hasCollectedData: boolean;
  readonly dataAsOf: Date | null;
  readonly metrics: PublicProjectMetrics | null;
}

export interface PublicUserProfileResult {
  readonly identity: PublicUserIdentity;
  readonly projects: readonly PublicUserProfileProjectResult[];

  readonly observedTotals: PublicProjectMetrics;
}

const CURSOR_VERSION = 1;

const IV_BYTES = 12;

const TAG_BYTES = 16;

const PAYLOAD_PAD_BLOCK = 64;

const KEY_BYTES = 32;

const CURSOR_KEY_SALT = 'oss-hub/public-projects/cursor/v1';

const CURSOR_KEY_INFO = 'public-project-cursor-aes-256-gcm';

const MIN_SESSION_SECRET_BYTES = 32;

export type PublicProjectCursorKey = Buffer;

const derivedKeyCache = new Map<string, PublicProjectCursorKey>();

function versionAad(): Buffer {
  return Buffer.from([CURSOR_VERSION]);
}

export interface PublicEligibilityCandidate {
  readonly githubRepositoryId: bigint;
  readonly publishedAt: Date;
}

@Injectable()
export class PublicEligibilityService {
  constructor(private readonly metrics: PublicEligibilityRepository) {}

  isPublicEligible(input: PublicEligibilityInput): boolean {
    if (!input.platformPublic || input.publishedAt === null) return false;

    const observation = input.observation;
    if (observation === null || observation.observedAt === null) return true;

    const isPrivateOrMissing =
      observation.visibility === 'PRIVATE' || observation.presence === 'ABSENT';
    if (!isPrivateOrMissing) return true;

    return observation.observedAt.getTime() <= input.publishedAt.getTime();
  }

  async filterEligibleRepositoryIds(
    candidates: readonly PublicEligibilityCandidate[],
  ): Promise<ReadonlySet<bigint>> {
    if (candidates.length === 0) return new Set();

    const metrics = await this.metrics.getRepositoryMetrics({
      repositoryIds: candidates.map(
        (candidate) => candidate.githubRepositoryId,
      ),
    });
    const observationByRepositoryId = new Map(
      metrics.map((metric) => [metric.repositoryId, metric]),
    );

    const eligible = new Set<bigint>();
    for (const candidate of candidates) {
      const metric = observationByRepositoryId.get(
        candidate.githubRepositoryId,
      );
      const decision = this.isPublicEligible({
        platformPublic: true,
        publishedAt: candidate.publishedAt,
        observation:
          metric === undefined
            ? null
            : {
                visibility: metric.visibility,
                presence: metric.presence,
                observedAt: metric.visibilityObservedAt,
              },
      });
      if (decision) eligible.add(candidate.githubRepositoryId);
    }
    return eligible;
  }

  async isEligible(candidate: PublicEligibilityCandidate): Promise<boolean> {
    const eligible = await this.filterEligibleRepositoryIds([candidate]);
    return eligible.has(candidate.githubRepositoryId);
  }
}

@Injectable()
export class PublicProjectsService {
  private readonly cursorKey: PublicProjectCursorKey;

  constructor(
    private readonly repository: PublicProjectsRepository,
    private readonly eligibility: PublicEligibilityService,
    private readonly metrics: PublicProjectMetricsRepository,
    @Inject(RUNTIME_CONFIG)
    runtimeConfig: Pick<RuntimeConfig, 'SESSION_SECRET'>,
    private readonly repositoryUrlService: RepositoryUrlService,
  ) {
    this.cursorKey = this.resolvePublicProjectCursorKey(runtimeConfig);
  }

  async findPage(
    pageId: string | undefined,
    pageSize: number,
    year?: number,
  ): Promise<PublicProjectPageResult> {
    const cursor =
      pageId === undefined
        ? null
        : this.decodePublicProjectCursor(pageId, this.cursorKey);
    const rows = await this.repository.listPage(cursor, pageSize + 1, year);
    const hasMore = rows.length > pageSize;
    const pageRows = rows.slice(0, pageSize);

    const eligible = await this.eligibility.filterEligibleRepositoryIds(
      pageRows.map((row) => ({
        githubRepositoryId: row.githubRepositoryId,
        publishedAt: row.publishedAt,
      })),
    );
    const items = pageRows
      .filter((row) => eligible.has(row.githubRepositoryId))
      .map((row) => this.toPublicProjectListItem(row));

    const lastRawRow = pageRows[pageRows.length - 1];
    const nextPageId =
      hasMore && lastRawRow !== undefined
        ? this.encodePublicProjectCursor(
            {
              publishedAt: lastRawRow.publishedAt,
              id: lastRawRow.id,
            },
            this.cursorKey,
          )
        : null;

    return { items, pageSize, nextPageId };
  }

  async findDetail(projectId: string): Promise<PublicProjectDetailResult> {
    const row = await this.repository.findById(projectId);
    if (row === null) {
      throw new DomainException(
        PUBLIC_PROJECTS_ERROR_CODES[PublicProjectsErrorCode.PROJECT_NOT_FOUND],
      );
    }

    const eligible = await this.eligibility.isEligible({
      githubRepositoryId: row.githubRepositoryId,
      publishedAt: row.publishedAt,
    });
    if (!eligible) {
      throw new DomainException(
        PUBLIC_PROJECTS_ERROR_CODES[PublicProjectsErrorCode.PROJECT_NOT_FOUND],
      );
    }

    const [metricsRows, contributorRows] = await Promise.all([
      this.metrics.getRepositoryCumulativeMetrics({
        repositoryIds: [row.githubRepositoryId],
      }),
      this.metrics.getContributorCumulativeMetrics({
        repositoryIds: [row.githubRepositoryId],
      }),
    ]);
    const metric = metricsRows[0];

    return {
      row: this.toPublicProjectListItem(row),
      metrics: {
        commitCount: metric?.commitCount ?? 0,
        pullRequestCount: metric?.pullRequestCount ?? 0,
        releaseCount: metric?.releaseCount ?? 0,
      },
      contributors: [...contributorRows]
        .sort((left, right) => right.commitCount - left.commitCount)
        .map((contributor) => ({
          githubLogin: contributor.githubLogin,
          commitCount: contributor.commitCount,
          pullRequestCount: contributor.pullRequestCount,
          releaseCount: contributor.releaseCount,
        })),
    };
  }

  async findProfile(userId: string): Promise<PublicUserProfileResult> {
    const [identity, rows] = await Promise.all([
      this.repository.findUserIdentity(userId),
      this.repository.listForUser(userId),
    ]);
    if (identity === null) {
      throw new DomainException(
        PUBLIC_PROJECTS_ERROR_CODES[
          PublicProjectsErrorCode.USER_PROFILE_NOT_FOUND
        ],
      );
    }

    const eligible = await this.eligibility.filterEligibleRepositoryIds(
      rows.map((row) => ({
        githubRepositoryId: row.githubRepositoryId,
        publishedAt: row.publishedAt,
      })),
    );
    const projects = rows.filter((row) => eligible.has(row.githubRepositoryId));
    if (projects.length === 0) {
      throw new DomainException(
        PUBLIC_PROJECTS_ERROR_CODES[
          PublicProjectsErrorCode.USER_PROFILE_NOT_FOUND
        ],
      );
    }

    const repositoryIds = projects.map((project) => project.githubRepositoryId);
    const [repositoryMetricsRows, contributorRows] = await Promise.all([
      this.metrics.getRepositoryCumulativeMetrics({ repositoryIds }),
      this.metrics.getContributorCumulativeMetrics({ repositoryIds }),
    ]);

    const observedByRepository = new Map(
      repositoryMetricsRows.map((metric) => [
        metric.repositoryId.toString(),
        metric,
      ]),
    );

    const ownContributionByRepository = new Map(
      contributorRows
        .filter((contributor) => contributor.githubUserId === identity.githubId)
        .map((contributor) => [
          contributor.repositoryId.toString(),
          contributor,
        ]),
    );

    const profileProjects: PublicUserProfileProjectResult[] = projects.map(
      (project) => {
        const key = project.githubRepositoryId.toString();
        const repositoryMetric = observedByRepository.get(key);
        if (repositoryMetric === undefined) {
          return {
            row: this.toPublicProjectListItem(project),
            observed: false,
            hasCollectedData: false,
            dataAsOf: null,
            metrics: null,
          };
        }
        const own = ownContributionByRepository.get(key);
        return {
          row: this.toPublicProjectListItem(project),
          observed: true,
          hasCollectedData: repositoryMetric.hasCollectedData,
          dataAsOf: repositoryMetric.dataAsOf,
          metrics: {
            commitCount: own?.commitCount ?? 0,
            pullRequestCount: own?.pullRequestCount ?? 0,
            releaseCount: own?.releaseCount ?? 0,
          },
        };
      },
    );

    const observedTotals = profileProjects.reduce<PublicProjectMetrics>(
      (totals, project) =>
        project.metrics === null
          ? totals
          : {
              commitCount: totals.commitCount + project.metrics.commitCount,
              pullRequestCount:
                totals.pullRequestCount + project.metrics.pullRequestCount,
              releaseCount: totals.releaseCount + project.metrics.releaseCount,
            },
      { commitCount: 0, pullRequestCount: 0, releaseCount: 0 },
    );

    return { identity, projects: profileProjects, observedTotals };
  }

  private toPublicProjectListItem(
    row: PublicProjectRow,
  ): PublicProjectListItem {
    const { nameWithOwner, ...project } = row;
    return {
      ...project,
      repositoryName:
        this.repositoryUrlService.repositoryNameFromNameWithOwner(
          nameWithOwner,
        ),
      githubUrl:
        this.repositoryUrlService.repositoryUrlFromNameWithOwner(nameWithOwner),
      applicationMode: this.applicationMode(row.teamMemberCount),
      displayName: this.displayNameOf(row),
    };
  }

  resolvePublicProjectCursorKey(config: {
    readonly SESSION_SECRET?: string;
  }): PublicProjectCursorKey {
    const raw = config.SESSION_SECRET;
    if (raw === undefined || raw.trim() === '') {
      throw new PublicProjectCursorSecretError(
        'SESSION_SECRET이 비어 있습니다.',
      );
    }
    const cached = derivedKeyCache.get(raw);
    if (cached !== undefined) return cached;

    const secret = Buffer.from(raw, 'base64url');
    if (secret.length < MIN_SESSION_SECRET_BYTES) {
      throw new PublicProjectCursorSecretError(
        `SESSION_SECRET은 base64url로 ${MIN_SESSION_SECRET_BYTES}바이트 이상이어야 합니다.`,
      );
    }
    const key = Buffer.from(
      hkdfSync('sha256', secret, CURSOR_KEY_SALT, CURSOR_KEY_INFO, KEY_BYTES),
    );
    derivedKeyCache.set(raw, key);
    return key;
  }

  encodePublicProjectCursor(
    cursor: PublicProjectCursor,
    key: PublicProjectCursorKey,
  ): string {
    const json = JSON.stringify({
      p: cursor.publishedAt.toISOString(),
      i: cursor.id,
    });
    const paddedLength =
      Math.ceil(json.length / PAYLOAD_PAD_BLOCK) * PAYLOAD_PAD_BLOCK;
    const payload = Buffer.from(json.padEnd(paddedLength, ' '), 'utf8');

    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(versionAad());
    const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
    return Buffer.concat([
      versionAad(),
      iv,
      cipher.getAuthTag(),
      ciphertext,
    ]).toString('base64url');
  }

  decodePublicProjectCursor(
    pageId: string,
    key: PublicProjectCursorKey,
  ): PublicProjectCursor {
    try {
      const token = Buffer.from(pageId, 'base64url');
      if (token.length <= 1 + IV_BYTES + TAG_BYTES) {
        throw new Error('malformed cursor length');
      }
      if (token[0] !== CURSOR_VERSION) {
        throw new Error('unsupported cursor version');
      }
      const iv = token.subarray(1, 1 + IV_BYTES);
      const tag = token.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
      const ciphertext = token.subarray(1 + IV_BYTES + TAG_BYTES);

      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAAD(versionAad());
      decipher.setAuthTag(tag);
      const payload = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]).toString('utf8');

      const decoded = JSON.parse(payload) as { p: unknown; i: unknown };
      if (typeof decoded.p !== 'string' || typeof decoded.i !== 'string') {
        throw new Error('malformed cursor shape');
      }
      const publishedAt = new Date(decoded.p);
      if (Number.isNaN(publishedAt.getTime())) {
        throw new Error('malformed cursor date');
      }
      return { publishedAt, id: decoded.i };
    } catch (error) {
      if (error instanceof PublicProjectCursorSecretError) throw error;
      throw new DomainException(
        PUBLIC_PROJECTS_ERROR_CODES[PublicProjectsErrorCode.INVALID_PAGE_ID],
      );
    }
  }

  applicationMode(teamMemberCount: number): PublicProjectApplicationMode {
    return teamMemberCount > 1
      ? PublicProjectApplicationMode.TEAM
      : PublicProjectApplicationMode.PERSONAL;
  }

  displayNameOf(row: {
    readonly teamName: string | null;
    readonly teamMemberCount: number;
    readonly applicantNickname: string;
  }): string {
    if (row.teamMemberCount > 1 && row.teamName) return row.teamName;
    return row.applicantNickname;
  }
}
