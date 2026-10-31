import { Inject, Injectable } from '@nestjs/common';
import { UsersAuthorityService } from '../users/users-authority.service';
import type { Readable } from 'node:stream';
import { ZipFile } from 'yazl';
import { DomainException } from '../platform/error-code.error';
import { type ObjectStoragePort } from '../platform/object-storage.types';
import { OBJECT_STORAGE } from '../platform/object-storage.config';
import {
  MILESTONE_DOCUMENTS_ERROR_CODES,
  MilestoneDocumentsErrorCode,
} from './milestone-documents-error-code.error';
import { MilestoneDocumentsRepository } from './milestone-documents.repository';
import {
  MilestoneDocumentArchiveRepository,
  type ProgramArchiveReader,
  MilestoneDocumentArchiveDocument,
  MilestoneDocumentArchiveTeam,
  MilestoneDocumentArchiveSubmission,
  ArchiveProgram,
} from './milestone-document-archive.repository';
import { MilestoneDocumentArchiveEntryError } from './milestone-document-archive.error';
import { SubmissionStatus } from '@prisma/client';
import { MilestoneDocumentRulesService } from './milestone-document-rules.service';

export type MilestoneDocumentArchiveGrouping = 'TEAM' | 'DOCUMENT';

export const MILESTONE_DOCUMENT_ARCHIVE_GROUPINGS: readonly MilestoneDocumentArchiveGrouping[] =
  ['TEAM', 'DOCUMENT'];

export type MilestoneDocumentArchiveLayout =
  MilestoneDocumentArchiveGrouping | 'FLAT';

const MILESTONE_DOCUMENT_ARCHIVE_MANIFEST_FILE_NAME = '제출현황.csv';

type MilestoneDocumentArchiveEntry =
  | {
      readonly kind: 'STORED_FILE';
      readonly path: string;

      readonly modifiedAt: Date;
      readonly storageKey: string;
      readonly sizeBytes: number;
    }
  | {
      readonly kind: 'INLINE_TEXT';
      readonly path: string;
      readonly modifiedAt: Date;
      readonly body: string;
    };

export type MilestoneDocumentArchiveCellState =
  'NOT_SUBMITTED' | 'PENDING' | 'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED';

type MilestoneDocumentArchiveOmission =
  | 'FILE_UNAVAILABLE'
  | 'CONTENT_UNAVAILABLE'
  | 'CONTENT_AND_FILE_UNAVAILABLE'
  | 'SUBMISSION_UNAVAILABLE';

export interface MilestoneDocumentArchiveCell {
  readonly documentId: string;
  readonly state: MilestoneDocumentArchiveCellState;
  readonly submittedAt: Date | null;

  readonly path: string | null;
  readonly omission: MilestoneDocumentArchiveOmission | null;
}

export interface MilestoneDocumentArchiveManifestRow {
  readonly team: MilestoneDocumentArchiveTeam;
  readonly cells: readonly MilestoneDocumentArchiveCell[];
}

export interface MilestoneDocumentArchivePlan {
  readonly entries: readonly MilestoneDocumentArchiveEntry[];
  readonly manifest: readonly MilestoneDocumentArchiveManifestRow[];

  readonly storedBytes: number;

  readonly inlineBytes: number;
}

export interface BuildMilestoneDocumentArchivePlanInput {
  readonly documents: readonly MilestoneDocumentArchiveDocument[];
  readonly teams: readonly MilestoneDocumentArchiveTeam[];
  readonly submissions: readonly MilestoneDocumentArchiveSubmission[];
  readonly layout: MilestoneDocumentArchiveLayout;
}

function cellKey(applicationId: string, documentId: string): string {
  return `${applicationId}::${documentId}`;
}

function submittedState(
  status: SubmissionStatus,
): MilestoneDocumentArchiveCellState {
  return status === SubmissionStatus.SUBMITTED ? 'PENDING' : status;
}

function archiveOmissionLabel(
  omission: MilestoneDocumentArchiveOmission,
): string {
  switch (omission) {
    case 'FILE_UNAVAILABLE':
      return '(첨부를 가져올 수 없음)';
    case 'CONTENT_UNAVAILABLE':
      return '(내용 없음)';
    case 'CONTENT_AND_FILE_UNAVAILABLE':
      return '(내용 없음 · 첨부를 가져올 수 없음)';
    case 'SUBMISSION_UNAVAILABLE':
      return '(제출 내용을 가져올 수 없음)';
  }
}

function uniquePath(path: string, taken: Set<string>): string {
  if (!taken.has(collisionKey(path))) {
    taken.add(collisionKey(path));
    return path;
  }
  const dot = path.lastIndexOf('.');
  const slash = path.lastIndexOf('/');

  const hasExtension = dot > slash + 1;
  const stem = hasExtension ? path.slice(0, dot) : path;
  const extension = hasExtension ? path.slice(dot) : '';
  for (let ordinal = 2; ; ordinal += 1) {
    const candidate = `${stem} (${ordinal})${extension}`;
    if (!taken.has(collisionKey(candidate))) {
      taken.add(collisionKey(candidate));
      return candidate;
    }
  }
}

function collisionKey(path: string): string {
  return path.normalize('NFC').toLowerCase();
}

function archiveDocumentsWithStageNames(
  milestones: ArchiveProgram['milestones'],
  isSingleMilestone: boolean,
): readonly MilestoneDocumentArchiveDocument[] {
  return milestones.flatMap((milestone) =>
    milestone.documents.map((document) => ({
      ...document,
      name: isSingleMilestone
        ? document.name
        : `${milestone.name} - ${document.name}`,
    })),
  );
}

const CELL_STATE_LABELS: Readonly<
  Record<MilestoneDocumentArchiveCellState, string>
> = {
  NOT_SUBMITTED: '미제출',
  PENDING: '검토 대기',
  APPROVED: '승인',
  CHANGES_REQUESTED: '보완 요청',
  REJECTED: '반려',
};

const OMISSION_LABELS: Readonly<
  Record<MilestoneDocumentArchiveOmission, string>
> = {
  FILE_UNAVAILABLE: '(첨부를 가져올 수 없음)',
  CONTENT_UNAVAILABLE: '(내용 없음)',
  CONTENT_AND_FILE_UNAVAILABLE: '(내용 없음 · 첨부를 가져올 수 없음)',
  SUBMISSION_UNAVAILABLE: '(제출 내용을 가져올 수 없음)',
};

const BOM = '\uFEFF';

const ROW_SEPARATOR = '\r\n';

const FORMULA_TRIGGERS = new Set(['=', '+', '-', '@', '\t', '\r']);

export interface MilestoneDocumentArchiveManifestCsvInput {
  readonly documents: readonly MilestoneDocumentArchiveDocument[];
  readonly rows: readonly MilestoneDocumentArchiveManifestRow[];
}

function cellOf(
  cells: readonly MilestoneDocumentArchiveCell[],
  documentId: string,
): MilestoneDocumentArchiveCell | null {
  return cells.find((cell) => cell.documentId === documentId) ?? null;
}

function cellColumns(cell: MilestoneDocumentArchiveCell | null): string[] {
  if (cell === null) return ['', '', ''];
  return [
    CELL_STATE_LABELS[cell.state],
    cell.submittedAt === null ? '' : formatSeoulDateTime(cell.submittedAt),
    cell.path ?? (cell.omission === null ? '' : OMISSION_LABELS[cell.omission]),
  ];
}

function formatSeoulDateTime(value: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',

    hourCycle: 'h23',
  }).formatToParts(value);
  const at = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${at('year')}-${at('month')}-${at('day')} ${at('hour')}:${at('minute')}`;
}

function csvField(value: string): string {
  const guarded = FORMULA_TRIGGERS.has(value.charAt(0)) ? `'${value}` : value;
  return /[",\r\n]/.test(guarded)
    ? `"${guarded.replace(/"/g, '""')}"`
    : guarded;
}

export type MilestoneDocumentArchiveScope =
  | {
      readonly kind: 'ALL';
      readonly grouping: MilestoneDocumentArchiveGrouping;
    }
  | { readonly kind: 'DOCUMENT'; readonly documentId: string };

export type ProgramDocumentArchiveScope = (
  | { readonly kind: 'PROGRAM' }
  | { readonly kind: 'MILESTONE'; readonly milestoneId: string }
  | { readonly kind: 'TEAM'; readonly teamId: string }
) & { readonly grouping?: MilestoneDocumentArchiveGrouping };

export interface MilestoneDocumentArchive {
  readonly body: Readable;
  readonly fileName: string;
  readonly contentType: 'application/zip';

  readonly contentLength: number | null;
}

const MAX_ARCHIVE_BYTES = 2 * 1024 * 1024 * 1024;

interface ZipFileFinalSize {
  end(
    options: { forceZip64Format: boolean; comment: string },
    onFinalSize: (finalSize: number) => void,
  ): void;
}

@Injectable()
export class MilestoneDocumentArchiveService {
  constructor(
    private readonly repository: MilestoneDocumentsRepository,
    @Inject(OBJECT_STORAGE)
    private readonly storage: ObjectStoragePort,
    @Inject(MilestoneDocumentArchiveRepository)
    private readonly programs: ProgramArchiveReader,
    @Inject(UsersAuthorityService)
    private readonly authority: Pick<
      UsersAuthorityService,
      'assertActiveStaff'
    >,
    private readonly milestoneDocumentRulesService: MilestoneDocumentRulesService,
  ) {}

  async archiveForProgramStaff(
    sessionGithubId: bigint,
    programId: string,
    scope: ProgramDocumentArchiveScope,
    now: Date = new Date(),
  ): Promise<MilestoneDocumentArchive> {
    await this.authority.assertActiveStaff(sessionGithubId, () =>
      this.error(MilestoneDocumentsErrorCode.STAFF_ONLY),
    );
    const program = await this.programs.findProgram(programId);
    if (program === null) {
      throw this.error(MilestoneDocumentsErrorCode.PROGRAM_NOT_FOUND);
    }
    const milestones =
      scope.kind === 'MILESTONE'
        ? program.milestones.filter((item) => item.id === scope.milestoneId)
        : program.milestones;
    if (scope.kind === 'MILESTONE' && milestones.length === 0) {
      throw this.error(MilestoneDocumentsErrorCode.MILESTONE_NOT_FOUND);
    }
    const teams = await this.programs.findApprovedTeams(
      programId,
      scope.kind === 'TEAM' ? scope.teamId : undefined,
    );
    if (scope.kind === 'TEAM' && teams.length === 0) {
      throw this.error(MilestoneDocumentsErrorCode.ARCHIVE_TEAM_NOT_FOUND);
    }
    const documents = archiveDocumentsWithStageNames(
      milestones,
      scope.kind === 'MILESTONE',
    );
    const submissions = await this.repository.findSubmissionsForArchive(
      documents.map((document) => document.id),
      now,
    );
    const plan = this.buildMilestoneDocumentArchivePlan({
      documents,
      teams,
      submissions,
      layout: scope.grouping ?? 'TEAM',
    });
    const milestone = milestones[0];
    const fileName =
      scope.kind === 'MILESTONE' && milestone !== undefined
        ? this.archiveFileName(milestone.name, milestone.dueAt)
        : `${this.milestoneDocumentRulesService.milestoneDocumentArchiveFolderName(`${program.name}_${scope.kind === 'TEAM' ? teams[0]?.teamName : '전체'}`)}_현재제출.zip`;
    return this.createArchive(documents, plan, fileName, now);
  }

  async archiveForStaff(
    sessionGithubId: bigint,
    milestoneId: string,
    scope: MilestoneDocumentArchiveScope,
    now: Date = new Date(),
  ): Promise<MilestoneDocumentArchive> {
    await this.authority.assertActiveStaff(sessionGithubId, () =>
      this.error(MilestoneDocumentsErrorCode.STAFF_ONLY),
    );
    const milestone = await this.repository.findMilestone(milestoneId);
    if (milestone === null) {
      throw this.error(MilestoneDocumentsErrorCode.MILESTONE_NOT_FOUND);
    }

    const [allDocuments, teams] = await Promise.all([
      this.repository.findByMilestoneId(milestoneId),
      this.repository.findApprovedApplicationsForCollection(
        milestone.programId,
      ),
    ]);

    const documents =
      scope.kind === 'DOCUMENT'
        ? allDocuments.filter((document) => document.id === scope.documentId)
        : allDocuments;
    if (scope.kind === 'DOCUMENT' && documents.length === 0) {
      throw this.error(MilestoneDocumentsErrorCode.DOCUMENT_NOT_FOUND);
    }

    const submissions = await this.repository.findSubmissionsForArchive(
      documents.map((document) => document.id),
      now,
    );

    const plan = this.buildMilestoneDocumentArchivePlan({
      documents,
      teams,
      submissions,
      layout: scope.kind === 'DOCUMENT' ? 'FLAT' : scope.grouping,
    });
    return this.createArchive(
      documents,
      plan,
      this.archiveFileName(
        scope.kind === 'DOCUMENT'
          ? (documents[0]?.name ?? milestone.name)
          : milestone.name,
        milestone.dueAt,
      ),
      now,
    );
  }

  private createArchive(
    documents: readonly MilestoneDocumentArchiveDocument[],
    plan: MilestoneDocumentArchivePlan,
    fileName: string,
    now: Date,
  ): MilestoneDocumentArchive {
    if (plan.storedBytes + plan.inlineBytes > MAX_ARCHIVE_BYTES) {
      throw this.error(MilestoneDocumentsErrorCode.ARCHIVE_TOO_LARGE);
    }

    const zip = new ZipFile();

    const output = zip.outputStream as Readable;

    zip.on('error', (error: unknown) => {
      output.destroy(error instanceof Error ? error : new Error(String(error)));
    });

    output.on('error', () => undefined);

    let activeBody: Readable | null = null;
    output.once('close', () => {
      activeBody?.destroy();
      activeBody = null;
    });

    zip.addBuffer(
      Buffer.from(
        this.milestoneDocumentArchiveManifestCsv({
          documents,
          rows: plan.manifest,
        }),
        'utf8',
      ),
      MILESTONE_DOCUMENT_ARCHIVE_MANIFEST_FILE_NAME,
      { mtime: now, compress: false },
    );

    for (const entry of plan.entries) {
      if (entry.kind === 'INLINE_TEXT') {
        zip.addBuffer(Buffer.from(entry.body, 'utf8'), entry.path, {
          mtime: entry.modifiedAt,
          compress: false,
        });
        continue;
      }

      zip.addReadStreamLazy(
        entry.path,
        { mtime: entry.modifiedAt, size: entry.sizeBytes, compress: false },
        (openStream) => {
          if (output.destroyed) {
            openStream(new Error('archive stream closed'), undefined as never);
            return;
          }
          this.storage.get(entry.storageKey).then(
            (body) => {
              if (output.destroyed) {
                body.destroy();
                openStream(
                  new Error('archive stream closed'),
                  undefined as never,
                );
                return;
              }

              body.once('error', (error: unknown) => {
                output.destroy(
                  new MilestoneDocumentArchiveEntryError(
                    entry.storageKey,
                    error,
                  ),
                );
              });
              activeBody = body;
              body.once('close', () => {
                if (activeBody === body) activeBody = null;
              });
              openStream(null, body);
            },

            (error: unknown) =>
              openStream(
                new MilestoneDocumentArchiveEntryError(entry.storageKey, error),
                undefined as never,
              ),
          );
        },
      );
    }

    let contentLength: number | null = null;
    (zip as unknown as ZipFileFinalSize).end(
      {
        forceZip64Format: needsZip64Eocd([
          MILESTONE_DOCUMENT_ARCHIVE_MANIFEST_FILE_NAME,
          ...plan.entries.map((entry) => entry.path),
        ]),
        comment: '',
      },
      (finalSize) => {
        contentLength = finalSize;
      },
    );

    return {
      body: output,
      fileName,
      contentType: 'application/zip',
      contentLength,
    };
  }

  private error(code: MilestoneDocumentsErrorCode): DomainException {
    return new DomainException(MILESTONE_DOCUMENTS_ERROR_CODES[code]);
  }

  buildMilestoneDocumentArchivePlan(
    input: BuildMilestoneDocumentArchivePlanInput,
  ): MilestoneDocumentArchivePlan {
    const { documents, teams, submissions, layout } = input;

    const cellIndex = new Map<string, MilestoneDocumentArchiveSubmission>();
    for (const submission of submissions) {
      cellIndex.set(
        cellKey(submission.applicationId, submission.milestoneDocumentId),
        submission,
      );
    }

    const takenPaths = new Set<string>([
      collisionKey(MILESTONE_DOCUMENT_ARCHIVE_MANIFEST_FILE_NAME),
    ]);
    const entries: MilestoneDocumentArchiveEntry[] = [];
    let storedBytes = 0;
    let inlineBytes = 0;

    const manifest = teams.map((team) => ({
      team,
      cells: documents.map((document) => {
        const submission =
          cellIndex.get(cellKey(team.applicationId, document.id)) ?? null;
        if (submission === null) {
          return {
            documentId: document.id,
            state: 'NOT_SUBMITTED' as const,
            submittedAt: null,
            path: null,
            omission: null,
          };
        }

        const state = submittedState(submission.status);
        const cellEntries = this.buildEntries({
          team,
          document,
          submission,
          layout,
        });
        const omission = this.archiveOmission(submission);
        if (cellEntries.length === 0) {
          return {
            documentId: document.id,
            state,
            submittedAt: submission.submittedAt,
            path: null,
            omission: omission ?? ('SUBMISSION_UNAVAILABLE' as const),
          };
        }

        const paths = cellEntries.map((entry) => {
          const path = uniquePath(entry.path, takenPaths);
          const placed = { ...entry, path };
          entries.push(placed);
          if (placed.kind === 'STORED_FILE') storedBytes += placed.sizeBytes;
          else inlineBytes += Buffer.byteLength(placed.body, 'utf8');
          return path;
        });
        return {
          documentId: document.id,
          state,
          submittedAt: submission.submittedAt,
          path:
            omission === null
              ? paths.join(' · ')
              : `${paths.join(' · ')} · ${archiveOmissionLabel(omission)}`,
          omission,
        };
      }),
    }));

    return { entries, manifest, storedBytes, inlineBytes };
  }

  private archiveOmission(
    submission: MilestoneDocumentArchiveSubmission,
  ): MilestoneDocumentArchiveOmission | null {
    const contentUnavailable =
      submission.content !== null &&
      this.milestoneDocumentRulesService.readMilestoneDocumentSubmittedContent(
        submission.content,
      ) === null;
    const fileUnavailable =
      submission.hasCurrentFileEvidence && submission.file === null;
    if (contentUnavailable && fileUnavailable)
      return 'CONTENT_AND_FILE_UNAVAILABLE';
    if (contentUnavailable) return 'CONTENT_UNAVAILABLE';
    if (fileUnavailable) return 'FILE_UNAVAILABLE';
    return null;
  }

  private buildEntries(input: {
    readonly team: MilestoneDocumentArchiveTeam;
    readonly document: MilestoneDocumentArchiveDocument;
    readonly submission: MilestoneDocumentArchiveSubmission;
    readonly layout: MilestoneDocumentArchiveLayout;
  }): readonly MilestoneDocumentArchiveEntry[] {
    const { team, document, submission, layout } = input;

    const prefix =
      layout === 'FLAT'
        ? ''
        : `${this.archiveFolderPath(layout === 'TEAM' ? team.teamName : document.name)}/`;

    const entries: MilestoneDocumentArchiveEntry[] = [];
    if (submission.file !== null) {
      const fileName =
        this.milestoneDocumentRulesService.milestoneDocumentDownloadFileName({
          teamName: team.teamName,
          documentName: document.name,
          originalFileName: submission.file.originalFileName,
        });
      entries.push({
        kind: 'STORED_FILE',
        path: `${prefix}${fileName}`,
        modifiedAt: submission.submittedAt,
        storageKey: submission.file.storageKey,
        sizeBytes: submission.file.sizeBytes,
      });
    }

    const content =
      this.milestoneDocumentRulesService.readMilestoneDocumentSubmittedContent(
        submission.content,
      );
    if (content !== null) {
      entries.push({
        kind: 'INLINE_TEXT',
        path: `${prefix}${this.milestoneDocumentRulesService.milestoneDocumentTextEntryFileName(
          {
            teamName: team.teamName,
            documentName: document.name,
          },
        )}`,
        modifiedAt: submission.submittedAt,
        body: content.text,
      });
    }
    return entries;
  }

  private archiveFolderPath(name: string): string {
    const folder =
      this.milestoneDocumentRulesService.milestoneDocumentArchiveFolderName(
        name,
      );

    return collisionKey(folder) ===
      collisionKey(MILESTONE_DOCUMENT_ARCHIVE_MANIFEST_FILE_NAME)
      ? `${folder} (2)`
      : folder;
  }

  private archiveFileName(name: string, dueAt: Date): string {
    const due = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(dueAt);
    return `${this.milestoneDocumentRulesService.milestoneDocumentArchiveFolderName(name)}_${due}.zip`;
  }

  milestoneDocumentArchiveManifestCsv(
    input: MilestoneDocumentArchiveManifestCsvInput,
  ): string {
    const header = [
      '팀',
      '신청자',
      '팀원',
      ...input.documents.flatMap((document) => [
        `${document.name} 상태`,
        `${document.name} 제출시각`,
        `${document.name} ZIP 파일`,
      ]),
    ];

    const lines = [
      header,
      ...input.rows.map((row) => [
        row.team.teamName,
        row.team.applicantName ?? '',
        row.team.memberNicknames.join(', '),

        ...input.documents.flatMap((document) =>
          cellColumns(cellOf(row.cells, document.id)),
        ),
      ]),
    ];

    return (
      BOM +
      lines.map((line) => line.map(csvField).join(',')).join(ROW_SEPARATOR) +
      ROW_SEPARATOR
    );
  }
}

function needsZip64Eocd(paths: readonly string[]): boolean {
  const centralDirectoryBytes = paths.reduce(
    (total, path) => total + 46 + Buffer.byteLength(path, 'utf8') + 9,
    0,
  );
  return centralDirectoryBytes >= 0xffff;
}
